import type { CardType, LearningItem } from '../types/curriculum';

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type CardProgress = {
  cardId: string;
  itemId: string;
  cardType: CardType;
  due: string;
  intervalDays: number;
  reviewCount: number;
  successCount: number;
  lapses: number;
  lastRating?: Rating;
  lastReviewedAt?: string;
};

export const QUEUE_NOISE_WINDOW = 8;
export const cardId = (itemId: string, type: CardType) => `${itemId}:${type}`;

export function initialStates(
  items: LearningItem[],
  existing: Record<string, CardProgress> = {},
) {
  const out = { ...existing };
  for (const item of items) {
    for (const type of item.enabledCardTypes) {
      const id = cardId(item.id, type);
      if (!out[id]) {
        out[id] = {
          cardId: id,
          itemId: item.id,
          cardType: type,
          due: new Date(0).toISOString(),
          intervalDays: 0,
          reviewCount: 0,
          successCount: 0,
          lapses: 0,
        };
      }
    }
  }
  return out;
}

export function review(s: CardProgress, rating: Rating, now = new Date()): CardProgress {
  const multiplier = { again: 0, hard: 1, good: 2.5, easy: 4 }[rating];
  const interval = rating === 'again' ? 0.02 : Math.max(1, Math.ceil((s.intervalDays || 1) * multiplier));
  return {
    ...s,
    due: new Date(now.getTime() + interval * 864e5).toISOString(),
    intervalDays: interval,
    reviewCount: s.reviewCount + 1,
    successCount: s.successCount + (rating === 'again' ? 0 : 1),
    lapses: s.lapses + (rating === 'again' ? 1 : 0),
    lastRating: rating,
    lastReviewedAt: now.toISOString(),
  };
}

export function isLearned(s?: CardProgress, now = new Date()) {
  return !!s
    && s.successCount >= 2
    && s.lastRating !== 'again'
    && new Date(s.due).getTime() - now.getTime() >= 3 * 864e5;
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function freshCardsWithGentleNoise(
  items: LearningItem[],
  states: Record<string, CardProgress>,
  day: string,
) {
  const itemById = new Map(items.map(item => [item.id, item]));
  const cardsByItem = new Map<string, CardProgress[]>();

  for (const state of Object.values(states).filter(state => state.reviewCount === 0)) {
    const cards = cardsByItem.get(state.itemId) || [];
    cards.push(state);
    cardsByItem.set(state.itemId, cards);
  }

  const orderedItems = [...cardsByItem.keys()]
    .map(id => itemById.get(id))
    .filter((item): item is LearningItem => !!item)
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank);

  const itemWindows: LearningItem[][] = [];
  for (const tier of [1, 2]) {
    const tierItems = orderedItems.filter(item => item.tier === tier);
    for (let start = 0; start < tierItems.length; start += QUEUE_NOISE_WINDOW) {
      const window = tierItems.slice(start, start + QUEUE_NOISE_WINDOW);
      window.sort((a, b) => hash(a.id + day) - hash(b.id + day) || a.rank - b.rank);
      itemWindows.push(window);
    }
  }

  const result: CardProgress[] = [];
  for (const window of itemWindows) {
    const cardGroups = window.map(item =>
      (cardsByItem.get(item.id) || []).sort((a, b) => a.cardType.localeCompare(b.cardType)),
    );
    const rounds = Math.max(0, ...cardGroups.map(cards => cards.length));
    for (let round = 0; round < rounds; round += 1) {
      for (const cards of cardGroups) {
        if (cards[round]) result.push(cards[round]);
      }
    }
  }
  return result;
}

function takePriorityGroupsWithoutAdjacentSiblings(groups: CardProgress[][], limit: number) {
  const result: CardProgress[] = [];
  for (const group of groups) {
    const remaining = [...group];
    while (remaining.length && result.length < limit) {
      let index = 0;
      const previous = result[result.length - 1];
      if (previous?.itemId === remaining[0].itemId) {
        const alternative = remaining.findIndex(card => card.itemId !== previous.itemId);
        if (alternative >= 0) index = alternative;
      }
      result.push(remaining.splice(index, 1)[0]);
    }
  }
  return result;
}

export function selectQueue(
  items: LearningItem[],
  states: Record<string, CardProgress>,
  limit = 20,
  now = new Date(),
) {
  const day = now.toISOString().slice(0, 10);
  const due = Object.values(states)
    .filter(state => new Date(state.due) <= now && state.reviewCount > 0)
    .sort((a, b) => a.due.localeCompare(b.due) || hash(a.cardId + day) - hash(b.cardId + day));
  const fresh = freshCardsWithGentleNoise(items, states, day);
  const itemById = new Map(items.map(item => [item.id, item]));
  return takePriorityGroupsWithoutAdjacentSiblings([
    due,
    fresh.filter(card => itemById.get(card.itemId)?.tier === 1),
    fresh.filter(card => itemById.get(card.itemId)?.tier === 2),
  ], limit);
}
