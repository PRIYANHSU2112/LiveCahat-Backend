import ExcelJS from 'exceljs';
import ApiError from './ApiError.js';

export const MAX_EXPORT_ROWS = 50_000;
export const EXPORT_BATCH_SIZE = 500;

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Build a download filename like users_2026-07-15.xlsx
 * @param {string} prefix
 * @returns {string}
 */
export function exportFilename(prefix) {
  const day = new Date().toISOString().slice(0, 10);
  const safe = String(prefix || 'export')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${safe || 'export'}_${day}.xlsx`;
}

/**
 * Count then stream an XLSX workbook to the HTTP response.
 * Rejects with 400 if row count exceeds maxRows before headers are sent.
 *
 * @param {import('express').Response} res
 * @param {object} options
 * @param {string} options.filename
 * @param {string} [options.sheetName]
 * @param {Array<{ header: string, key: string, width?: number }>} options.columns
 * @param {() => Promise<number>} options.countFn
 * @param {() => AsyncIterable<object>} options.rowIteratorFn - yields plain row objects keyed by column.key
 * @param {number} [options.maxRows]
 */
export async function streamXlsx(res, options) {
  const {
    filename,
    sheetName = 'Data',
    columns,
    countFn,
    rowIteratorFn,
    maxRows = MAX_EXPORT_ROWS,
  } = options;

  const total = await countFn();
  if (total > maxRows) {
    throw new ApiError(
      400,
      `Export exceeds ${maxRows.toLocaleString()} rows (${total.toLocaleString()} matched). Narrow your filters and try again.`
    );
  }

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/"/g, '')}"`
  );
  res.setHeader('Cache-Control', 'no-store');
  // Prevent intermediate caches from transforming the binary body
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: false,
    useSharedStrings: true,
  });

  const sheet = workbook.addWorksheet(String(sheetName).slice(0, 31) || 'Data');
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 16,
  }));

  let written = 0;
  for await (const row of rowIteratorFn()) {
    written += 1;
    if (written > maxRows) break;
    sheet.addRow(row).commit();
  }

  await sheet.commit();
  await workbook.commit();
}

/**
 * Helper: stream from a Mongoose query cursor with mapRow.
 * @param {import('express').Response} res
 * @param {object} opts
 * @param {string} opts.filename
 * @param {string} [opts.sheetName]
 * @param {Array<{ header: string, key: string, width?: number }>} opts.columns
 * @param {import('mongoose').Query} opts.query - lean find query (no exec yet)
 * @param {(doc: object) => object} opts.mapRow
 * @param {number} [opts.maxRows]
 * @param {number} [opts.batchSize]
 */
export async function streamXlsxFromQuery(res, opts) {
  const {
    filename,
    sheetName,
    columns,
    query,
    mapRow,
    maxRows = MAX_EXPORT_ROWS,
    batchSize = EXPORT_BATCH_SIZE,
  } = opts;

  const countFn = async () => query.clone().countDocuments();

  const rowIteratorFn = async function* () {
    const cursor = query.clone().cursor({ batchSize });
    for await (const doc of cursor) {
      yield mapRow(doc);
    }
  };

  await streamXlsx(res, {
    filename,
    sheetName,
    columns,
    countFn,
    rowIteratorFn,
    maxRows,
  });
}

/**
 * Format a date for Excel cells.
 * @param {Date|string|null|undefined} value
 * @returns {string}
 */
export function formatExportDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

/**
 * Join first + last name safely.
 * @param {{ firstName?: string, lastName?: string }|null|undefined} user
 * @returns {string}
 */
export function formatFullName(user) {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}
