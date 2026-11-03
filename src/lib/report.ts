/**
 * Writes the json report in Newman's shape.
 *
 * The Postman CLI's json report names each request it ran but does not carry
 * the request itself, and calls assertions `tests`. Tools written against
 * Newman's report read `run.executions[].item` and `.assertions`, so the CLI's
 * report is rewritten into that shape, using the temporary collection the flow
 * ran: each of its items has an id, and the CLI reports that id back.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PostmanItem } from './types.js';

/** The parts of the Postman CLI's json report that are read here. */
export interface CliReport {
  run: {
    meta?: { collectionName?: string; started?: number; completed?: number };
    summary?: unknown;
    executions?: Array<{
      requestExecuted?: { id?: string; name?: string };
      response?: unknown;
      tests?: Array<{ name: string; status: string; error?: unknown }>;
      errors?: unknown[];
    }>;
    runError?: unknown;
  };
}

/** The temporary collection a flow ran, as built by `buildTempCollection`. */
export interface RunCollection {
  info: { name: string };
  item: PostmanItem[];
}

/** Rewrite a Postman CLI json report into Newman's shape. Exported for unit-testability. */
export function toNewmanReport(report: CliReport, collection: RunCollection) {
  const byId = new Map(collection.item.map((item) => [item.id, item]));
  const executions = (report.run.executions ?? []).map((e) => ({
    id: e.requestExecuted?.id,
    item: byId.get(e.requestExecuted?.id) ?? { name: e.requestExecuted?.name },
    response: e.response,
    assertions: (e.tests ?? []).map((t) => ({
      assertion: t.name,
      ...(t.status === 'passed' ? {} : { error: t.error ?? { message: t.status } }),
    })),
    ...(e.errors?.length ? { requestError: e.errors[0] } : {}),
  }));
  return {
    collection,
    run: {
      summary: report.run.summary,
      timings: { started: report.run.meta?.started, completed: report.run.meta?.completed },
      executions,
      failures: executions.flatMap((e) =>
        e.assertions.filter((a) => a.error).map((a) => ({ error: a.error, source: e.item })),
      ),
      error: report.run.runError ?? null,
    },
  };
}

/**
 * Where Newman would have written the report: the path itself, or, for a
 * directory, `newman-run-report-<timestamp>-0.json` inside it.
 */
export function reportPath(exportPath: string, now = new Date()): string {
  const isDir =
    exportPath.endsWith('/') ||
    exportPath.endsWith(path.sep) ||
    (fs.existsSync(exportPath) && fs.statSync(exportPath).isDirectory());
  if (!isDir) return exportPath;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    pad(now.getMilliseconds(), 3),
  ].join('-');
  return path.join(exportPath, `newman-run-report-${stamp}-0.json`);
}

/** Read the CLI's report and write it, in Newman's shape, where it was asked for. */
export function writeNewmanReport(
  cliReportPath: string,
  collection: RunCollection,
  exportPath: string,
): void {
  const report = JSON.parse(fs.readFileSync(cliReportPath, 'utf8')) as CliReport;
  const target = reportPath(exportPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(toNewmanReport(report, collection), null, 2));
}
