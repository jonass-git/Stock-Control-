function listMovements(db, filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.productId) {
    conditions.push('m.product_id = ?');
    params.push(Number(filters.productId));
  }
  if (filters.workerId) {
    conditions.push('m.worker_id = ?');
    params.push(Number(filters.workerId));
  }
  if (filters.movementType) {
    conditions.push('m.movement_type = ?');
    params.push(String(filters.movementType));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(1000, Math.max(1, Number.parseInt(filters.limit, 10) || 250));

  return db.prepare(`
    SELECT
      m.*,
      p.name AS product_name,
      p.sku AS product_sku,
      p.is_active AS product_is_active,
      w.name AS worker_name,
      w.employee_code AS worker_code,
      w.role AS worker_role,
      s.ticket_number AS ticket_number
    FROM stock_movements m
    INNER JOIN products p ON p.id = m.product_id
    INNER JOIN workers w ON w.id = m.worker_id
    LEFT JOIN sales s ON s.id = m.sale_id
    ${whereClause}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).all(...params, limit);
}

module.exports = {
  listMovements
};
