import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { reportPath, toNewmanReport } from '../../src/lib/report.js';

const collection = {
  info: { name: 'API — Flow: Viewing' },
  item: [
    {
      id: 'step-1',
      name: 'View [actor=admin]',
      request: { method: 'GET', url: { raw: '{{url}}/a' } },
    },
    {
      id: 'step-2',
      name: 'View [actor=member]',
      request: { method: 'GET', url: { raw: '{{url}}/a' } },
    },
  ],
};

describe('toNewmanReport', () => {
  it('matches each execution to the step it ran, by id', () => {
    const report = toNewmanReport(
      {
        run: {
          executions: [
            {
              requestExecuted: { id: 'step-2', name: 'View [actor=member]' },
              response: { code: 403 },
              tests: [
                { name: 'Status code is 403', status: 'passed' },
                { name: 'No body', status: 'failed', error: { message: 'nope' } },
              ],
            },
          ],
        },
      },
      collection,
    );
    const [exec] = report.run.executions;
    expect(report.collection.info.name).toBe('API — Flow: Viewing');
    expect(exec.item).toBe(collection.item[1]);
    expect(exec.response).toEqual({ code: 403 });
    expect(exec.assertions).toEqual([
      { assertion: 'Status code is 403' },
      { assertion: 'No body', error: { message: 'nope' } },
    ]);
    expect(report.run.failures).toHaveLength(1);
  });
});

describe('reportPath', () => {
  const now = new Date(2026, 10, 3, 9, 5, 7, 42);

  it('names a report in a directory the way Newman did', () => {
    expect(reportPath('out/', now)).toBe(
      path.join('out', 'newman-run-report-2026-11-03-09-05-07-042-0.json'),
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'));
    expect(path.dirname(reportPath(dir, now))).toBe(dir);
  });

  it('keeps a file path as it is', () => {
    expect(reportPath('out/report.json', now)).toBe('out/report.json');
  });
});
