import { Client } from '@notionhq/client';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

function getClient(): Client {
  const key = import.meta.env.NOTION_API_KEY;
  if (!key) throw new Error('NOTION_API_KEY is not set');
  return new Client({ auth: key });
}

export interface NormalizedRecord {
  id: string;
  url: string;
  icon?: string;
  createdTime: string;
  lastEditedTime: string;
  properties: Record<string, any>;
}

export interface SectionConfig {
  id: string;
  name: string;
  description: string;
  database_id: string | null;
  route: string;
  icon: string;
}

export interface RelatedDatabases {
  activities?: string;
}

export function loadSectionConfig(): SectionConfig[] {
  const raw = fs.readFileSync('./src/data/databases.yaml', 'utf8');
  const parsed = yaml.load(raw) as { sections: SectionConfig[]; related_databases?: RelatedDatabases };
  return parsed.sections;
}

export function loadRelatedDatabases(): RelatedDatabases {
  const raw = fs.readFileSync('./src/data/databases.yaml', 'utf8');
  const parsed = yaml.load(raw) as { sections: SectionConfig[]; related_databases?: RelatedDatabases };
  return parsed.related_databases ?? {};
}

export async function fetchSectionRecords(section: SectionConfig): Promise<NormalizedRecord[]> {
  if (!section.database_id) {
    console.warn(`Section "${section.id}" has no database_id configured; returning empty.`);
    return [];
  }
  return fetchDatabaseRecords(section.database_id);
}

export async function fetchDatabaseRecords(databaseId: string): Promise<NormalizedRecord[]> {
  const notion = getClient();
  const results: any[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response: any = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    });
    results.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);

  return results.map((page) => normalizePage(page));
}

export async function fetchActivitiesRecords(): Promise<NormalizedRecord[]> {
  const related = loadRelatedDatabases();
  if (!related.activities) {
    console.warn('No activities database_id configured in databases.yaml');
    return [];
  }
  return fetchDatabaseRecords(related.activities);
}

export async function fetchPage(pageId: string): Promise<NormalizedRecord> {
  const notion = getClient();
  const page = await notion.pages.retrieve({ page_id: pageId });
  return normalizePage(page);
}

export function normalizePage(page: any): NormalizedRecord {
  const props = page.properties ?? {};
  return {
    id: page.id,
    url: page.url,
    icon: page.icon?.type === 'emoji' ? page.icon.emoji : undefined,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    properties: Object.fromEntries(
      Object.entries(props).map(([key, value]: [string, any]) => {
        return [key, extractValue(value)];
      })
    ),
  };
}

export function debugPropertyShape(prop: any): { type: string; valueType: string; hasLatLng: boolean } {
  const type = prop?.type ?? 'unknown';
  const raw = prop?.[type];
  const valueType = raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw;
  const hasLatLng = raw && typeof raw === 'object' && !Array.isArray(raw) && 'latitude' in raw && 'longitude' in raw;
  return { type, valueType, hasLatLng };
}

function extractValue(prop: any): any {
  switch (prop.type) {
    case 'title':
      return prop.title?.map((t: any) => t.plain_text).join('') ?? '';
    case 'rich_text':
      return prop.rich_text?.map((t: any) => t.plain_text).join('') ?? '';
    case 'select':
      return prop.select?.name ?? null;
    case 'multi_select':
      return prop.multi_select?.map((s: any) => s.name) ?? [];
    case 'number':
      return prop.number ?? null;
    case 'url':
      return prop.url ?? null;
    case 'email':
      return prop.email ?? null;
    case 'phone_number':
      return prop.phone_number ?? null;
    case 'checkbox':
      return prop.checkbox ?? false;
    case 'relation':
      return prop.relation?.map((r: any) => r.id) ?? [];
    case 'formula':
      return prop.formula?.[prop.formula.type] ?? null;
    case 'rollup':
      return prop.rollup?.array?.map(extractValue) ?? [];
    case 'date':
      return prop.date;
    case 'people':
      return prop.people?.map((p: any) => ({ id: p.id, name: p.name })) ?? [];
    case 'files':
      return prop.files?.map((f: any) => f.external?.url ?? f.file?.url) ?? [];
    case 'location':
      return prop.location ?? null;
    default:
      const raw = prop[prop.type];
      if (raw === undefined || raw === null) return raw;
      if (typeof raw === 'object') return raw;
      return raw;
  }
}

export function buildRecordMap(records: NormalizedRecord[]): Map<string, NormalizedRecord> {
  return new Map(records.map((r) => [r.id, r]));
}

export function resolveRelations(
  record: NormalizedRecord,
  lookups: {
    tags?: Map<string, NormalizedRecord>;
    activities?: Map<string, NormalizedRecord>;
    sources?: Map<string, NormalizedRecord>;
    affiliations?: Map<string, NormalizedRecord>;
  }
) {
  const props = record.properties;
  const tagIds: string[] = Array.isArray(props['Tags']) ? props['Tags'] : [];
  const activityIds: string[] = Array.isArray(props['Activities']) ? props['Activities'] : [];
  const sourceIds: string[] = Array.isArray(props['Sources']) ? props['Sources'] : [];
  const affiliationIds: string[] = Array.isArray(props['Network Affiliation']) ? props['Network Affiliation'] : [];

  return {
    tags: tagIds.map((id) => lookups.tags?.get(id)).filter(Boolean) as NormalizedRecord[],
    activities: activityIds.map((id) => lookups.activities?.get(id)).filter(Boolean) as NormalizedRecord[],
    sources: sourceIds.map((id) => lookups.sources?.get(id)).filter(Boolean) as NormalizedRecord[],
    affiliations: affiliationIds.map((id) => lookups.affiliations?.get(id)).filter(Boolean) as NormalizedRecord[],
  };
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  return md
    .replace(/^### (.*$)/gim, '<h3 style="font-size:1.1rem;font-weight:500;margin:1.5rem 0 0.75rem 0;color:var(--fg);font-family:var(--sans);letter-spacing:-0.01em;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="font-size:1.25rem;font-weight:500;margin:1.75rem 0 0.75rem 0;color:var(--fg);font-family:var(--sans);letter-spacing:-0.01em;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="font-size:1.5rem;font-weight:500;margin:2rem 0 1rem 0;color:var(--fg);font-family:var(--sans);letter-spacing:-0.01em;">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">$1</a>')
    .split(/\n\s*\n/)
    .map((p) => p.trim() ? `<p style="font-size:0.95rem;color:var(--fg);line-height:1.6;margin:0 0 0.75rem 0;">${p.replace(/\n/g, '<br>')}</p>` : '')
    .join('');
}

export function getTitle(record: NormalizedRecord): string {
  return String(record.properties['Name'] ?? record.properties['Title'] ?? record.properties['name'] ?? record.properties['title'] ?? 'Untitled');
}

// Ontology/tag titles are stored Snake_Case (e.g. "Watershed_Repair") — display them as
// "Watershed Repair" everywhere they show up as a badge label. Underscores only; doesn't
// otherwise reformat casing, since some titles are already mixed-case on purpose.
export function humanize(text: string): string {
  return text.replace(/_/g, ' ');
}

// Org type/category badges get color (2026-08-12) — purple/pink/blue, deliberately not the pillar
// colors, so a category badge never reads as a pillar badge. Category values are open-ended
// (Notion-driven, not a fixed enum), so instead of a hand-curated lookup this hashes the string to
// one of the three tones — same category always gets the same color, without needing to know the
// full set of values in advance.
const CATEGORY_TONES = ['purple', 'pink', 'blue'] as const;
export type CategoryTone = (typeof CATEGORY_TONES)[number];

export function toneForCategory(category: string): CategoryTone {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) | 0;
  }
  return CATEGORY_TONES[Math.abs(hash) % CATEGORY_TONES.length];
}

export function getDescription(record: NormalizedRecord): string {
  return String(record.properties['Description'] ?? record.properties['description'] ?? '');
}

export function getUrl(record: NormalizedRecord): string | null {
  return record.properties['website'] ?? record.properties['Website'] ?? record.properties['URL'] ?? record.properties['Url'] ?? record.properties['url'] ?? null;
}

export function getPlace(record: NormalizedRecord): string {
  const place = record.properties['Place'] ?? record.properties['place'];
  if (place && typeof place === 'object') {
    if ('address' in place && place.address) return String(place.address);
    if ('name' in place && place.name) return String(place.name);
  }
  return String(
    record.properties['place'] ?? record.properties['Place'] ??
    record.properties['Scope'] ?? record.properties['scope'] ??
    record.properties['Location'] ?? record.properties['location'] ??
    ''
  );
}

export function getCategory(record: NormalizedRecord): string {
  return String(
    record.properties['category'] ?? record.properties['Category'] ??
    record.properties['type'] ?? record.properties['Type'] ??
    ''
  );
}

export async function fetchPageBlocks(pageId: string): Promise<any[]> {
  const notion = getClient();
  const results: any[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response: any = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });
    results.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);

  return results;
}

function richTextToHtml(richText: any[]): string {
  if (!richText || richText.length === 0) return '';
  return richText.map((t) => {
    let text = t.plain_text ?? '';
    if (t.annotations?.bold) text = `<strong>${text}</strong>`;
    if (t.annotations?.italic) text = `<em>${text}</em>`;
    if (t.annotations?.underline) text = `<u>${text}</u>`;
    if (t.annotations?.strikethrough) text = `<s>${text}</s>`;
    if (t.annotations?.code) text = `<code style="font-family:var(--mono);background:var(--surface);padding:0.1rem 0.25rem;border-radius:var(--radius-sm);">${text}</code>`;
    if (t.href) text = `<a href="${t.href}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${text}</a>`;
    return text;
  }).join('');
}

export async function renderBlocksToHtml(blocks: any[]): Promise<string> {
  const parts: string[] = [];

  for (const block of blocks) {
    const type = block.type;
    const value = block[type];
    if (!value) continue;

    const text = richTextToHtml(value.rich_text ?? value.text ?? []);

    switch (type) {
      case 'paragraph':
        if (text) parts.push(`<p style="font-size:0.95rem;color:var(--fg);line-height:1.6;margin:0 0 0.75rem 0;">${text}</p>`);
        break;
      case 'heading_1':
        parts.push(`<h2 style="font-size:1.5rem;font-weight:500;margin:2rem 0 1rem 0;color:var(--fg);font-family:var(--sans);letter-spacing:-0.01em;">${text}</h2>`);
        break;
      case 'heading_2':
        parts.push(`<h2 style="font-size:1.25rem;font-weight:500;margin:1.75rem 0 0.75rem 0;color:var(--fg);font-family:var(--sans);letter-spacing:-0.01em;">${text}</h2>`);
        break;
      case 'heading_3':
        parts.push(`<h3 style="font-size:1.1rem;font-weight:500;margin:1.5rem 0 0.75rem 0;color:var(--fg);font-family:var(--sans);letter-spacing:-0.01em;">${text}</h3>`);
        break;
      case 'bulleted_list_item':
        parts.push(`<li style="font-size:0.95rem;color:var(--fg);line-height:1.6;margin:0 0 0.35rem 0;">${text}</li>`);
        break;
      case 'numbered_list_item':
        parts.push(`<li style="font-size:0.95rem;color:var(--fg);line-height:1.6;margin:0 0 0.35rem 0;">${text}</li>`);
        break;
      case 'quote':
        parts.push(`<blockquote style="border-left:3px solid var(--border);padding-left:1rem;margin:0 0 1rem 0;color:var(--muted);font-size:0.95rem;line-height:1.6;">${text}</blockquote>`);
        break;
      case 'callout':
        parts.push(`<div style="display:flex;gap:0.75rem;align-items:flex-start;padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);margin:0 0 1rem 0;"><span style="font-size:1.2rem;flex-shrink:0;">${value.icon?.emoji ?? '💡'}</span><div style="font-size:0.95rem;color:var(--fg);line-height:1.6;">${text}</div></div>`);
        break;
      case 'divider':
        parts.push(`<hr style="border:none;border-top:1px solid var(--border);margin:1.5rem 0;" />`);
        break;
      case 'image':
        const imgUrl = value.external?.url ?? value.file?.url ?? '';
        if (imgUrl) parts.push(`<img src="${imgUrl}" alt="" style="max-width:100%;border-radius:var(--radius);margin:0 0 1rem 0;" />`);
        break;
      case 'bookmark':
        parts.push(`<a href="${value.url}" target="_blank" rel="noopener noreferrer" style="display:block;padding:0.75rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--fg);text-decoration:none;margin:0 0 1rem 0;font-size:0.9rem;">${value.url}</a>`);
        break;
      case 'link_to_page':
        const linkedPageId = value.page_id ?? value.database_id ?? '';
        if (linkedPageId) parts.push(`<a href="${linkedPageId.replace(/-/g, '')}" style="display:block;padding:0.75rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--primary);text-decoration:none;margin:0 0 1rem 0;font-size:0.9rem;">Linked page</a>`);
        break;
      case 'table_of_contents':
        break;
      default:
        if (text) parts.push(`<p style="font-size:0.95rem;color:var(--fg);line-height:1.6;margin:0 0 0.75rem 0;">${text}</p>`);
        break;
    }
  }

  return parts.join('');
}
