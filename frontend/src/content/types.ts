export type Choice = 'A' | 'B';
export interface Scenario {
  case_id: string;
  scenario_id: string;
  title: string;
  template: 'table' | 'cards';
  background: string;
  common_facts: string[];
  comparison: { attribute: string; A: string; B: string }[];
  additional_information: { kind: string; title: string; text: string }[];
  references: { document_id: string; title: string; url: string; revision: string }[];
  task: string;
  knowledge: { title: string; text: string }[];
  options: { id: Choice; label: string }[];
  revision: string;
}
export interface SharedCopy {
  welcome: string;
  choice_prompt: string;
  confidence_prompt: string;
  confidence_scale: string;
  pre_prompt: string;
  probe_prompt: string;
  post_prompt: string;
  revision: string;
}
export interface MaterialBundle {
  schema_version: string;
  bundle_revision: string;
  shared: SharedCopy;
  scenarios: Scenario[];
}
