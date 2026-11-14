(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildRowXml(rowNum, cells) {
    const cellsStr = cells
      .map((c) => {
        const ref = `${c.col}${rowNum}`;
        if (c.type === 'n') {
          return `<c r="${ref}" s="${c.style}"><v>${c.val}</v></c>`;
        }
        return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t>${escapeXml(c.val)}</t></is></c>`;
      })
      .join('');
    return `<row r="${rowNum}">${cellsStr}</row>`;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZipBytes(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((f) => {
      const nameBytes = encoder.encode(f.name);
      const dataBytes = encoder.encode(f.content);
      const checksum = crc32(dataBytes);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, checksum, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, dataBytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, checksum, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);
      offset += localHeader.length + dataBytes.length;
    });

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const totalLength = offset + centralSize + eocd.length;
    const output = new Uint8Array(totalLength);
    let cursor = 0;
    for (const part of localParts) {
      output.set(part, cursor);
      cursor += part.length;
    }
    for (const part of centralParts) {
      output.set(part, cursor);
      cursor += part.length;
    }
    output.set(eocd, cursor);
    return output;
  }

  function buildStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00&quot; €&quot;"/>
  </numFmts>
  <fonts count="6">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF991B1B"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="4" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="4" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;
  }

  function buildXlsxBytes(sheetName, colWidths, rowsXml, mergeEndCol) {
    const colsXml = colWidths
      .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
      .join('\n    ');

    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    ${colsXml}
  </cols>
  <sheetData>
    ${rowsXml.join('\n    ')}
  </sheetData>
  <mergeCells count="1">
    <mergeCell ref="A1:${mergeEndCol}1"/>
  </mergeCells>
</worksheet>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    return buildZipBytes([
      { name: '[Content_Types].xml', content: contentTypesXml },
      { name: '_rels/.rels', content: relsXml },
      { name: 'xl/workbook.xml', content: workbookXml },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
      { name: 'xl/styles.xml', content: buildStylesXml() },
      { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml }
    ]);
  }

  function getDateStrings() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return {
      dateFile: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      dateReadable: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    };
  }

  async function saveXlsxWithDialog(defaultName, bytes, toastLabel) {
    const res = await window.posAPI.saveFile({
      title: 'Guardar reporte Excel (.xlsx)',
      defaultName,
      filters: [{ name: 'Libro de Excel', extensions: ['xlsx'] }],
      data: Array.from(bytes),
      isBinary: true
    });
    if (!res.canceled) {
      POSApp.utils.showToast(`${toastLabel} guardado en ${res.filePath}`, 'success');
    }
  }

  async function exportInventoryXlsx(products) {
    if (!products || products.length === 0) {
      POSApp.utils.showToast('No hay productos para exportar', 'error');
      return;
    }

    const { dateFile, dateReadable } = getDateStrings();
    const totalUnits = products.reduce((s, p) => s + Number(p.stock || 0), 0);
    const totalValue = products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.price || 0), 0);
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const rowsXml = [];

    rowsXml.push(buildRowXml(1, cols.map((c, idx) => ({ col: c, type: 's', val: idx === 0 ? 'CONTROL DE STOCK E INVENTARIO' : '', style: 1 }))));
    rowsXml.push(buildRowXml(2, [
      { col: 'A', type: 's', val: `Fecha: ${dateReadable}`, style: 2 },
      { col: 'B', type: 's', val: '', style: 2 },
      { col: 'C', type: 's', val: `Referencias: ${products.length}`, style: 2 },
      { col: 'D', type: 's', val: `Unidades: ${totalUnits}`, style: 2 },
      { col: 'E', type: 's', val: '', style: 2 },
      { col: 'F', type: 's', val: '', style: 2 },
      { col: 'G', type: 's', val: '', style: 2 },
      { col: 'H', type: 's', val: '', style: 2 }
    ]));

    const headers = ['Código / SKU', 'Producto', 'Categoría', 'Stock Actual', 'Stock Mínimo', 'Estado', 'Precio Unitario (€)', 'Valor Total (€)'];
    rowsXml.push(buildRowXml(4, headers.map((h, i) => ({ col: cols[i], type: 's', val: h, style: 3 }))));

    products.forEach((p, idx) => {
      const r = 5 + idx;
      const st = POSApp.utils.getStockStatus(p);
      const stStyle = st.key === 'ok' ? 11 : 10;
      const lineTotal = Number(p.stock || 0) * Number(p.price || 0);
      rowsXml.push(buildRowXml(r, [
        { col: 'A', type: 's', val: p.sku || '-', style: 4 },
        { col: 'B', type: 's', val: p.name || '', style: 4 },
        { col: 'C', type: 's', val: p.category || 'General', style: 4 },
        { col: 'D', type: 'n', val: Number(p.stock || 0), style: 5 },
        { col: 'E', type: 'n', val: Number(p.min_stock ?? p.minStock ?? 0), style: 5 },
        { col: 'F', type: 's', val: st.label, style: stStyle },
        { col: 'G', type: 'n', val: Number(p.price || 0), style: 6 },
        { col: 'H', type: 'n', val: Number(lineTotal.toFixed(2)), style: 6 }
      ]));
    });

    const totalRow = 5 + products.length;
    rowsXml.push(buildRowXml(totalRow, [
      { col: 'A', type: 's', val: 'TOTAL INVENTARIO', style: 7 },
      { col: 'B', type: 's', val: `${products.length} productos`, style: 7 },
      { col: 'C', type: 's', val: '', style: 7 },
      { col: 'D', type: 'n', val: totalUnits, style: 8 },
      { col: 'E', type: 's', val: '', style: 7 },
      { col: 'F', type: 's', val: '', style: 7 },
      { col: 'G', type: 's', val: '', style: 7 },
      { col: 'H', type: 'n', val: Number(totalValue.toFixed(2)), style: 9 }
    ]));

    const bytes = buildXlsxBytes('Inventario', [16, 34, 18, 15, 15, 15, 20, 20], rowsXml, 'H');
    await saveXlsxWithDialog(`Control_Stock_${dateFile}.xlsx`, bytes, 'Excel de inventario');
  }

  async function exportSalesXlsx(sales) {
    if (!sales || sales.length === 0) {
      POSApp.utils.showToast('No hay ventas para exportar', 'error');
      return;
    }

    const { dateFile, dateReadable } = getDateStrings();
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const rowsXml = [];

    rowsXml.push(buildRowXml(1, cols.map((c, idx) => ({ col: c, type: 's', val: idx === 0 ? 'HISTORIAL DE VENTAS POS' : '', style: 1 }))));
    rowsXml.push(buildRowXml(2, [
      { col: 'A', type: 's', val: `Exportado: ${dateReadable}`, style: 2 },
      { col: 'B', type: 's', val: `Tickets: ${sales.length}`, style: 2 },
      ...cols.slice(2).map((c) => ({ col: c, type: 's', val: '', style: 2 }))
    ]));

    const headers = ['Ticket', 'Fecha / Hora', 'Trabajador', 'Artículos', 'Pago', 'Estado', 'Total (€)'];
    rowsXml.push(buildRowXml(4, headers.map((h, i) => ({ col: cols[i], type: 's', val: h, style: 3 }))));

    let grandTotal = 0;
    sales.forEach((s, idx) => {
      const r = 5 + idx;
      const itemsText = (s.items || []).map((i) => `${i.quantity}x ${i.product_name_snapshot}`).join(', ');
      if (s.status === 'completed') grandTotal += Number(s.total_amount || 0);
      rowsXml.push(buildRowXml(r, [
        { col: 'A', type: 's', val: s.ticket_number, style: 4 },
        { col: 'B', type: 's', val: POSApp.utils.formatDateTime(s.created_at), style: 4 },
        { col: 'C', type: 's', val: `${s.worker_name} (${s.worker_code})`, style: 4 },
        { col: 'D', type: 's', val: itemsText, style: 4 },
        { col: 'E', type: 's', val: POSApp.utils.paymentLabel(s.payment_method), style: 4 },
        { col: 'F', type: 's', val: s.status === 'cancelled' ? 'Anulada' : 'Completada', style: s.status === 'cancelled' ? 10 : 11 },
        { col: 'G', type: 'n', val: Number(Number(s.total_amount || 0).toFixed(2)), style: 6 }
      ]));
    });

    rowsXml.push(buildRowXml(5 + sales.length, [
      { col: 'A', type: 's', val: 'TOTAL COMPLETADAS', style: 7 },
      { col: 'B', type: 's', val: '', style: 7 },
      { col: 'C', type: 's', val: '', style: 7 },
      { col: 'D', type: 's', val: '', style: 7 },
      { col: 'E', type: 's', val: '', style: 7 },
      { col: 'F', type: 's', val: '', style: 7 },
      { col: 'G', type: 'n', val: Number(grandTotal.toFixed(2)), style: 9 }
    ]));

    const bytes = buildXlsxBytes('Ventas', [20, 20, 24, 42, 14, 14, 18], rowsXml, 'G');
    await saveXlsxWithDialog(`Ventas_POS_${dateFile}.xlsx`, bytes, 'Excel de ventas');
  }

  async function exportMovementsXlsx(movements) {
    if (!movements || movements.length === 0) {
      POSApp.utils.showToast('No hay movimientos para exportar', 'error');
      return;
    }

    const { dateFile, dateReadable } = getDateStrings();
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const rowsXml = [];

    rowsXml.push(buildRowXml(1, cols.map((c, idx) => ({ col: c, type: 's', val: idx === 0 ? 'KARDEX DE MOVIMIENTOS DE STOCK' : '', style: 1 }))));
    rowsXml.push(buildRowXml(2, [
      { col: 'A', type: 's', val: `Exportado: ${dateReadable}`, style: 2 },
      { col: 'B', type: 's', val: `Movimientos: ${movements.length}`, style: 2 },
      ...cols.slice(2).map((c) => ({ col: c, type: 's', val: '', style: 2 }))
    ]));

    const headers = ['Fecha / Hora', 'Producto', 'SKU', 'Tipo', 'Anterior', 'Variación', 'Nuevo', 'Trabajador / Motivo'];
    rowsXml.push(buildRowXml(4, headers.map((h, i) => ({ col: cols[i], type: 's', val: h, style: 3 }))));

    movements.forEach((m, idx) => {
      const r = 5 + idx;
      const lbl = POSApp.utils.movementLabel(m.movement_type).label;
      rowsXml.push(buildRowXml(r, [
        { col: 'A', type: 's', val: POSApp.utils.formatDateTime(m.created_at), style: 4 },
        { col: 'B', type: 's', val: m.product_name, style: 4 },
        { col: 'C', type: 's', val: m.product_sku || '-', style: 4 },
        { col: 'D', type: 's', val: lbl, style: 4 },
        { col: 'E', type: 'n', val: Number(m.previous_stock), style: 5 },
        { col: 'F', type: 'n', val: Number(m.quantity_delta), style: 5 },
        { col: 'G', type: 'n', val: Number(m.new_stock), style: 5 },
        { col: 'H', type: 's', val: `${m.worker_name} — ${m.reason || ''}`, style: 4 }
      ]));
    });

    const bytes = buildXlsxBytes('Kardex', [20, 30, 16, 16, 12, 12, 12, 38], rowsXml, 'H');
    await saveXlsxWithDialog(`Kardex_Stock_${dateFile}.xlsx`, bytes, 'Excel de Kardex');
  }

  POSApp.xlsx = {
    exportInventoryXlsx,
    exportSalesXlsx,
    exportMovementsXlsx
  };
})(window);
