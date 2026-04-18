/**
 * newman-flows programmatic API.
 *
 * Provides the same capabilities as the CLI but callable from Node.js code:
 *
 *   import { runFlow, runAllFlows, validateCollection } from 'newman-flows';
 *
 *   await runFlow({ collection: './my.postman_collection.json', flow: 'Org admin creates org' });
 *   await runAllFlows({ collection: './my.postman_collection.json' });
 *
 *   const result = validateCollection(collection);
 *   if (result.errors.length > 0) { ... }
 */

export { getFlowSummaries, printFlowList } from './commands/list.js';
export { runFlow, runAllFlows } from './commands/run.js';
export { validateCollection, printValidationResult } from './commands/validate.js';
export {
  loadCollection,
  resolveCollectionPath,
  resolveEnvironmentPath,
  findFolder,
  findRequest,
} from './lib/collection.js';
export { listFlows, extractFlowDef, findFlowRequest } from './lib/flows.js';
export type {
  FlowDef,
  PostmanBody,
  PostmanCollection,
  PostmanEvent,
  PostmanFormDataField,
  PostmanInfo,
  PostmanItem,
  PostmanRequest,
  PostmanScript,
  RunOptions,
} from './lib/types.js';
export type { FlowSummary } from './commands/list.js';
export type { ValidationResult } from './commands/validate.js';
