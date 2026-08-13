import type { NormalizedRecord } from './notion';
import { getTitle } from './notion';

// Shared ontology parent/child grouping — previously duplicated (with slightly different
// shapes) in src/components/OntologyGallery.astro and src/pages/[section]/[slug].astro's
// getStaticPaths. Detects a self-referential relation property that links ontology items to
// their parent theme (Notion doesn't expose a fixed property name for this, so it's a
// duck-typed heuristic: whichever relation property most often points back into the same
// record set wins).
export function findParentRelationKey(items: NormalizedRecord[]): string | null {
  const itemIds = new Set(items.map((r) => r.id));
  const candidateScores: Record<string, number> = {};

  for (const r of items) {
    for (const [key, value] of Object.entries(r.properties)) {
      if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.replace(/-/g, '').length === 32)) {
        if (value.some((v) => itemIds.has(v))) {
          candidateScores[key] = (candidateScores[key] ?? 0) + 1;
        }
      }
    }
  }

  const sorted = Object.entries(candidateScores).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

function getSortOrder(r: NormalizedRecord): number {
  const raw = r.properties['Sort order'] ?? r.properties['sort order'] ?? r.properties['Sort Order'] ?? r.properties['sort_order'];
  const num = typeof raw === 'number' ? raw : Number(raw);
  return isNaN(num) ? Infinity : num;
}

export interface ParentChildSplit {
  parentKey: string | null;
  parents: NormalizedRecord[];
  childrenByParent: Record<string, NormalizedRecord[]>;
}

// Splits a flat list of ontology records into top-level "themes" (parents) and their child
// tags, sorted by Sort order then alphabetically — same grouping every ontology surface
// (gallery grid, welcome-sidebar theme count, full-page children prop) should use.
export function splitParentsAndChildren(items: NormalizedRecord[]): ParentChildSplit {
  const parentKey = findParentRelationKey(items);
  const parents: NormalizedRecord[] = [];
  const childrenByParent: Record<string, NormalizedRecord[]> = {};

  for (const r of items) {
    const rawParent = parentKey ? r.properties[parentKey] : null;
    const parentId = Array.isArray(rawParent) ? rawParent[0] : rawParent;

    if (!parentId) {
      parents.push(r);
    } else {
      if (!childrenByParent[parentId]) childrenByParent[parentId] = [];
      childrenByParent[parentId].push(r);
    }
  }

  const bySortThenTitle = (a: NormalizedRecord, b: NormalizedRecord) => {
    const orderDiff = getSortOrder(a) - getSortOrder(b);
    return orderDiff !== 0 ? orderDiff : getTitle(a).localeCompare(getTitle(b));
  };

  parents.sort(bySortThenTitle);
  for (const pid of Object.keys(childrenByParent)) {
    childrenByParent[pid].sort(bySortThenTitle);
  }

  return { parentKey, parents, childrenByParent };
}

export interface BlockSplit {
  intro: any[];
  sections: Record<string, any[]>;
}

function getBlockHeadingText(block: any): string {
  const type = block?.type;
  if (type !== 'heading_1' && type !== 'heading_2' && type !== 'heading_3') return '';
  const richText = block[type]?.rich_text ?? [];
  return richText.map((t: any) => t.plain_text ?? '').join('').trim();
}

// Splits a flat Notion page-body block list into an "intro" run (everything before the first
// matching heading) plus one run per requested heading label (keyed by the lowercased label it
// matched, not the heading's literal text), each run starting with the heading block itself so
// it renders as part of that section's HTML. Some ontology records are authored in Notion with
// their own "Ontology"/"Activities" headings followed by an inline database embed (a block type
// our renderer can't turn into HTML, so it silently drops out) — this lets that Notion-authored
// heading double as the section header while the app fills the embed gap with the live-rendered
// tag/activity data, instead of the app inventing a second, redundant heading of its own.
// Matching is a case-insensitive prefix check (not exact), since some records phrase the heading
// as a variant like "Ontology Tags" rather than plain "Ontology" — still the same heading, still
// the same fill-the-embed-gap case.
export function splitBlocksByHeadings(blocks: any[], labels: string[]): BlockSplit {
  const wanted = labels.map((l) => l.toLowerCase());
  const intro: any[] = [];
  const sections: Record<string, any[]> = {};
  let current: any[] | null = null;

  for (const block of blocks) {
    const headingText = getBlockHeadingText(block).toLowerCase();
    const matchedLabel = headingText ? wanted.find((l) => headingText.startsWith(l)) : undefined;
    if (matchedLabel) {
      current = [block];
      sections[matchedLabel] = current;
      continue;
    }
    (current ?? intro).push(block);
  }

  return { intro, sections };
}
