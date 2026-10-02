/**
 * Shared TypeScript interfaces for Postman collection structures.
 *
 * These mirror the Postman Collection v2.1 schema used throughout the runner
 * and validator. Only the fields we actually read are declared; unknown fields
 * are silently ignored by the JSON parser.
 */

export interface PostmanScript {
  type: string;
  exec: string[];
  packages?: Record<string, unknown>;
}

export interface PostmanEvent {
  listen: 'prerequest' | 'test';
  script: PostmanScript;
}

export interface PostmanFormDataField {
  key: string;
  type?: string;
  src?: string;
  value?: string;
}

export interface PostmanBody {
  mode: 'raw' | 'formdata' | 'file' | 'urlencoded';
  raw?: string;
  formdata?: PostmanFormDataField[];
  file?: { src: string };
  options?: { raw?: { language?: string } };
}

export interface PostmanRequest {
  method: string;
  url: { raw: string; host?: string[]; path?: string[] };
  header?: Array<{ key: string; value: string }>;
  body?: PostmanBody;
  auth?: { type: string };
  description?: string;
}

export interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
  response?: unknown[];
}

export interface PostmanInfo {
  name: string;
  _postman_id?: string;
  schema: string;
  _exporter_id?: string;
}

export interface PostmanCollection {
  info: PostmanInfo;
  item: PostmanItem[];
  event?: PostmanEvent[];
  variable?: Array<{ key: string; value: string; type?: string }>;
  /** Collection-level auth, inherited by every request set to inherit it. */
  auth?: Record<string, unknown>;
}

/** A value a flow step may pass to its request. */
export type StepVarValue = string | number | boolean;

/**
 * One step of a flow: the request to run and, optionally, variables to set
 * for that request only. A plain string in `steps([...])` becomes
 * `{ step: '<name>' }`.
 */
export interface FlowStep {
  step: string;
  vars?: Record<string, StepVarValue>;
}

/** A resolved flow definition: name + ordered steps. */
export interface FlowDef {
  name: string;
  /** Request names, in order. One entry per step, repeats included. */
  steps: string[];
  /**
   * The same steps with their variables. Optional so that a hand-built
   * `FlowDef` with names only keeps working; when absent, every step runs
   * with no variables.
   */
  stepDefs?: FlowStep[];
}

/** Options shared by run-related commands. */
export interface RunOptions {
  /** Absolute or relative path to the collection JSON file. */
  collection: string;
  /** Absolute or relative path to a Postman environment JSON file. */
  env?: string;
  /**
   * Newman reporters to activate. Accepts a single reporter name or an array.
   * Defaults to `'cli'` when omitted.
   *
   * @example ['cli', 'junit', 'htmlextra']
   */
  reporters?: string | string[];
  /**
   * Per-reporter configuration passed directly to `newman.run()`.
   * Keys are reporter names; values are the reporter-specific option objects.
   *
   * @example { junit: { export: './results.xml' }, htmlextra: { export: './report.html' } }
   */
  reporter?: Record<string, unknown>;
}
