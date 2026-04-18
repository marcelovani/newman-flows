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
}

/** A resolved flow definition: name + ordered step names. */
export interface FlowDef {
  name: string;
  steps: string[];
}

/** Options shared by run-related commands. */
export interface RunOptions {
  /** Absolute or relative path to the collection JSON file. */
  collection: string;
  /** Absolute or relative path to a Postman environment JSON file. */
  env?: string;
  /** Directory where junit XML and HTML reports are written. Defaults to <cwd>/tests/results/newman. */
  resultsDir?: string;
}
