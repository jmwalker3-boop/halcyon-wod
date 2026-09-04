import type { RuleConfig } from './types.js';
export declare const DEFAULT_RULE_CONFIG: RuleConfig;
export declare function mergeRuleConfig(fromDb: Partial<RuleConfig> | undefined): RuleConfig;
