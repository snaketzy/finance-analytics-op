import type { Category } from '../api';

export type CategoryGroup = { parent: Category; children: Category[] };

/** 按 parentId 归组为「领域父节点 -> 子科目」，均按 sortOrder 排序。 */
export function buildCategoryGroups(list: Category[]): CategoryGroup[] {
  const bySort = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.id - b.id;
  return list
    .filter((c) => c.parentId === null)
    .sort(bySort)
    .map((parent) => ({
      parent,
      children: list.filter((c) => c.parentId === parent.id).sort(bySort),
    }));
}
