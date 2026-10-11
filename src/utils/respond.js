export const ok = (res, data, meta) =>
  res.json(meta ? { success: true, data, meta } : { success: true, data });

export const created = (res, data, meta) =>
  res.status(201).json(meta ? { success: true, data, meta } : { success: true, data });

export const noContent = (res) => res.status(204).send();

export const paginated = (res, items, { page = 1, limit = 25, total = 0 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(Number(limit) || 25, 100));
  const totalNum = Number(total) || 0;
  const totalPages = limitNum > 0 ? Math.ceil(totalNum / limitNum) : 1;

  return res.json({
    success: true,
    data: items,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalNum,
      totalPages,
      hasNext: pageNum < totalPages,
      hasPrev: pageNum > 1,
    },
  });
};
