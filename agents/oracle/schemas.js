'use strict';

// The "submit" tools: each step's answer, as a JSON Schema the agent fills in.

const LEVEL = { type: 'string', enum: ['high', 'medium', 'low'] };

const SUBMIT_FINDINGS = {
  name: 'submit_findings',
  description: 'Hand in your audit. Call once, at the end.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            places: { type: 'array', items: { type: 'string' }, minItems: 1 },
            agreement: { type: 'string' },
            unguarded: { type: 'string' },
            trigger: { type: 'string' },
            effect: { type: 'string' },
            fix: { type: 'string' },
            likelihood: LEVEL,
            harm: LEVEL,
          },
          required: ['places', 'agreement', 'unguarded', 'trigger', 'effect', 'fix', 'likelihood', 'harm'],
        },
      },
      current_bugs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            places: { type: 'array', items: { type: 'string' }, minItems: 1 },
            what: { type: 'string' },
            security: { type: 'boolean' },
          },
          required: ['places', 'what'],
        },
      },
    },
    required: ['findings', 'current_bugs'],
  },
};

const SUBMIT_GROUPS = {
  name: 'submit_groups',
  description: 'Hand in the grouping. Every id in exactly one group.',
  input_schema: {
    type: 'object',
    properties: {
      groups: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    },
    required: ['groups'],
  },
};

const SUBMIT_VERDICTS = {
  name: 'submit_verdicts',
  description: 'Hand in a verdict for every finding. Call once, at the end.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            verdict: { type: 'string', enum: ['confirmed', 'rejected', 'unsure'] },
            note: { type: 'string' },
          },
          required: ['id', 'verdict', 'note'],
        },
      },
    },
    required: ['verdicts'],
  },
};

const SUBMIT_MATCHES = {
  name: 'submit_matches',
  description: 'Hand in the matches. Call once, at the end.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            current: { type: 'string' },
            previous: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
          required: ['current', 'previous'],
        },
      },
    },
    required: ['matches'],
  },
};

const SUBMIT_STATUSES = {
  name: 'submit_statuses',
  description: 'Hand in a status for every finding. Call once, at the end.',
  input_schema: {
    type: 'object',
    properties: {
      statuses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['still_open', 'fixed', 'guarded', 'broke', 'unsure'] },
            note: { type: 'string' },
          },
          required: ['id', 'status', 'note'],
        },
      },
    },
    required: ['statuses'],
  },
};

module.exports = { SUBMIT_FINDINGS, SUBMIT_GROUPS, SUBMIT_VERDICTS, SUBMIT_MATCHES, SUBMIT_STATUSES };
