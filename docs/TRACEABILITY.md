# SSOT → ADR → PRD → ticket traceability

Status: **STATIC SEMANTIC CATALOG — planning authority graph for D0-004A**

D0-004A makes the static authority graph executable. The catalog below is a static planning input: it binds the SSOT, each PRD path, required ADRs, requirement count, exact PRD acceptance IDs, owned ticket IDs, requirement → PRD acceptance edges authored from PRD requirement and AC text, PRD acceptance → ticket edges authored from ticket goals and ownership, an independent planned-test structure keyed by planned test path with exact named cases, and an explicit ticket-acceptance binding for every ticket ID + ticket acceptance ID to exactly one planned test path and exact named case set. Case-only ticket prose still requires an explicit catalog path; global reverse lookup of case names is not authority.

JSON object key order in this catalog is not schema-significant; validators compare sets and sorted multi-values, never insertion order.

<!-- AOS_SEMANTIC_CATALOG_V2_START -->
```json
{
  "schema_version": 2,
  "ssot": "docs/north-star/agent-operator-score-ssot-v1.0.md",
  "prds": [
    {
      "id": "D0",
      "path": "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
      "adr_ids": [
        "ADR-0001",
        "ADR-0003",
        "ADR-0012"
      ],
      "requirement_count": 5,
      "acceptance_ids": [
        "AC-D0-1",
        "AC-D0-2",
        "AC-D0-3",
        "AC-D0-4",
        "AC-D0-5",
        "AC-D0-6"
      ],
      "ticket_ids": [
        "D0-001",
        "D0-002",
        "D0-003",
        "D0-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-D0-1",
            "AC-D0-2"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-D0-3",
            "AC-D0-5"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-D0-4"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-D0-2",
            "AC-D0-3"
          ]
        },
        {
          "requirement_key": "5",
          "acceptance_ids": [
            "AC-D0-6"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-D0-1",
          "ticket_ids": [
            "D0-001"
          ]
        },
        {
          "acceptance_id": "AC-D0-2",
          "ticket_ids": [
            "D0-001",
            "D0-002",
            "D0-004"
          ]
        },
        {
          "acceptance_id": "AC-D0-3",
          "ticket_ids": [
            "D0-002",
            "D0-004"
          ]
        },
        {
          "acceptance_id": "AC-D0-4",
          "ticket_ids": [
            "D0-003"
          ]
        },
        {
          "acceptance_id": "AC-D0-5",
          "ticket_ids": [
            "D0-002"
          ]
        },
        {
          "acceptance_id": "AC-D0-6",
          "ticket_ids": [
            "D0-002"
          ]
        }
      ]
    },
    {
      "id": "E0-A",
      "path": "docs/prd/PRD-E0A-metric-and-score-issuance-contract.md",
      "adr_ids": [
        "ADR-0004",
        "ADR-0005",
        "ADR-0006"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E0A-1",
        "AC-E0A-2",
        "AC-E0A-3",
        "AC-E0A-4"
      ],
      "ticket_ids": [
        "E0A-001",
        "E0A-002",
        "E0A-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E0A-1",
            "AC-E0A-4"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E0A-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E0A-2",
            "AC-E0A-4"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0A-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E0A-1",
          "ticket_ids": [
            "E0A-001"
          ]
        },
        {
          "acceptance_id": "AC-E0A-2",
          "ticket_ids": [
            "E0A-002"
          ]
        },
        {
          "acceptance_id": "AC-E0A-3",
          "ticket_ids": [
            "E0A-003"
          ]
        },
        {
          "acceptance_id": "AC-E0A-4",
          "ticket_ids": [
            "E0A-001"
          ]
        }
      ]
    },
    {
      "id": "E0-B",
      "path": "docs/prd/PRD-E0B-adapter-observability-contract.md",
      "adr_ids": [
        "ADR-0007"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E0B-1",
        "AC-E0B-2",
        "AC-E0B-3"
      ],
      "ticket_ids": [
        "E0B-001",
        "E0B-002",
        "E0B-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E0B-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E0B-1",
            "AC-E0B-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E0B-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0B-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E0B-1",
          "ticket_ids": [
            "E0B-001"
          ]
        },
        {
          "acceptance_id": "AC-E0B-2",
          "ticket_ids": [
            "E0B-002"
          ]
        },
        {
          "acceptance_id": "AC-E0B-3",
          "ticket_ids": [
            "E0B-003"
          ]
        }
      ]
    },
    {
      "id": "E0-C",
      "path": "docs/prd/PRD-E0C-pack-time-and-eligibility-simulation.md",
      "adr_ids": [
        "ADR-0009"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E0C-1",
        "AC-E0C-2",
        "AC-E0C-3"
      ],
      "ticket_ids": [
        "E0C-001",
        "E0C-002",
        "E0C-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E0C-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E0C-1",
            "AC-E0C-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E0C-2"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0C-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E0C-1",
          "ticket_ids": [
            "E0C-001",
            "E0C-002"
          ]
        },
        {
          "acceptance_id": "AC-E0C-2",
          "ticket_ids": [
            "E0C-002"
          ]
        },
        {
          "acceptance_id": "AC-E0C-3",
          "ticket_ids": [
            "E0C-003"
          ]
        }
      ]
    },
    {
      "id": "E0-D",
      "path": "docs/prd/PRD-E0D-deterministic-prescription-input-contract.md",
      "adr_ids": [
        "ADR-0010"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E0D-1",
        "AC-E0D-2",
        "AC-E0D-3"
      ],
      "ticket_ids": [
        "E0D-001",
        "E0D-002",
        "E0D-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E0D-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E0D-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E0D-2"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0D-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E0D-1",
          "ticket_ids": [
            "E0D-001"
          ]
        },
        {
          "acceptance_id": "AC-E0D-2",
          "ticket_ids": [
            "E0D-002"
          ]
        },
        {
          "acceptance_id": "AC-E0D-3",
          "ticket_ids": [
            "E0D-003"
          ]
        }
      ]
    },
    {
      "id": "E1",
      "path": "docs/prd/PRD-E1-trace-and-result-schemas.md",
      "adr_ids": [
        "ADR-0004",
        "ADR-0007"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E1-1",
        "AC-E1-2",
        "AC-E1-3"
      ],
      "ticket_ids": [
        "E1-001",
        "E1-002",
        "E1-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E1-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E1-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E1-2"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E1-1",
            "AC-E1-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E1-1",
          "ticket_ids": [
            "E1-001",
            "E1-003"
          ]
        },
        {
          "acceptance_id": "AC-E1-2",
          "ticket_ids": [
            "E1-002"
          ]
        },
        {
          "acceptance_id": "AC-E1-3",
          "ticket_ids": [
            "E1-003"
          ]
        }
      ]
    },
    {
      "id": "E10",
      "path": "docs/prd/PRD-E10-report-and-one-lever.md",
      "adr_ids": [
        "ADR-0002",
        "ADR-0004",
        "ADR-0006",
        "ADR-0010"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E10-1",
        "AC-E10-2",
        "AC-E10-3",
        "AC-E10-4"
      ],
      "ticket_ids": [
        "E10-001",
        "E10-002",
        "E10-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E10-1",
            "AC-E10-4"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E10-3"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E10-1",
            "AC-E10-4"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E10-2",
            "AC-E10-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E10-1",
          "ticket_ids": [
            "E10-001"
          ]
        },
        {
          "acceptance_id": "AC-E10-2",
          "ticket_ids": [
            "E10-001"
          ]
        },
        {
          "acceptance_id": "AC-E10-3",
          "ticket_ids": [
            "E10-002"
          ]
        },
        {
          "acceptance_id": "AC-E10-4",
          "ticket_ids": [
            "E10-003"
          ]
        }
      ]
    },
    {
      "id": "E11",
      "path": "docs/prd/PRD-E11-form-b-and-retest-modes.md",
      "adr_ids": [
        "ADR-0009",
        "ADR-0010"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E11-1",
        "AC-E11-2",
        "AC-E11-3",
        "AC-E11-4"
      ],
      "ticket_ids": [
        "E11-001",
        "E11-002",
        "E11-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E11-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E11-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E11-4"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E11-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E11-1",
          "ticket_ids": [
            "E11-001"
          ]
        },
        {
          "acceptance_id": "AC-E11-2",
          "ticket_ids": [
            "E11-002"
          ]
        },
        {
          "acceptance_id": "AC-E11-3",
          "ticket_ids": [
            "E11-003"
          ]
        },
        {
          "acceptance_id": "AC-E11-4",
          "ticket_ids": [
            "E11-002"
          ]
        }
      ]
    },
    {
      "id": "E12",
      "path": "docs/prd/PRD-E12-human-alpha-and-validation.md",
      "adr_ids": [
        "ADR-0011"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E12-1",
        "AC-E12-2",
        "AC-E12-3",
        "AC-E12-4"
      ],
      "ticket_ids": [
        "E12-001",
        "E12-002",
        "E12-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E12-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E12-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E12-2",
            "AC-E12-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E12-3",
            "AC-E12-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E12-1",
          "ticket_ids": [
            "E12-001"
          ]
        },
        {
          "acceptance_id": "AC-E12-2",
          "ticket_ids": [
            "E12-002"
          ]
        },
        {
          "acceptance_id": "AC-E12-3",
          "ticket_ids": [
            "E12-003"
          ]
        },
        {
          "acceptance_id": "AC-E12-4",
          "ticket_ids": [
            "E12-001"
          ]
        }
      ]
    },
    {
      "id": "E13",
      "path": "docs/prd/PRD-E13-snapshot-estimate.md",
      "adr_ids": [
        "ADR-0002"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E13-1",
        "AC-E13-2",
        "AC-E13-3"
      ],
      "ticket_ids": [
        "E13-001",
        "E13-002"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E13-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E13-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E13-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E13-1",
            "AC-E13-2",
            "AC-E13-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E13-1",
          "ticket_ids": [
            "E13-001"
          ]
        },
        {
          "acceptance_id": "AC-E13-2",
          "ticket_ids": [
            "E13-002"
          ]
        },
        {
          "acceptance_id": "AC-E13-3",
          "ticket_ids": [
            "E13-001"
          ]
        }
      ]
    },
    {
      "id": "E14",
      "path": "docs/prd/PRD-E14-public-oss-and-g4.md",
      "adr_ids": [
        "ADR-0001",
        "ADR-0012"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E14-1",
        "AC-E14-2",
        "AC-E14-3",
        "AC-E14-4"
      ],
      "ticket_ids": [
        "E14-001",
        "E14-002",
        "E14-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E14-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E14-3"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E14-2"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E14-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E14-1",
          "ticket_ids": [
            "E14-001"
          ]
        },
        {
          "acceptance_id": "AC-E14-2",
          "ticket_ids": [
            "E14-003"
          ]
        },
        {
          "acceptance_id": "AC-E14-3",
          "ticket_ids": [
            "E14-002"
          ]
        },
        {
          "acceptance_id": "AC-E14-4",
          "ticket_ids": [
            "E14-001"
          ]
        }
      ]
    },
    {
      "id": "E2",
      "path": "docs/prd/PRD-E2-deterministic-scorer-and-conformance.md",
      "adr_ids": [
        "ADR-0005",
        "ADR-0006",
        "ADR-0011"
      ],
      "requirement_count": 5,
      "acceptance_ids": [
        "AC-E2-1",
        "AC-E2-2",
        "AC-E2-3",
        "AC-E2-4"
      ],
      "ticket_ids": [
        "E2-001",
        "E2-002",
        "E2-003",
        "E2-004",
        "E2-005"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E2-2"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E2-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E2-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E2-4"
          ]
        },
        {
          "requirement_key": "5",
          "acceptance_ids": [
            "AC-E2-1"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E2-1",
          "ticket_ids": [
            "E2-001",
            "E2-005"
          ]
        },
        {
          "acceptance_id": "AC-E2-2",
          "ticket_ids": [
            "E2-002",
            "E2-003"
          ]
        },
        {
          "acceptance_id": "AC-E2-3",
          "ticket_ids": [
            "E2-003"
          ]
        },
        {
          "acceptance_id": "AC-E2-4",
          "ticket_ids": [
            "E2-004",
            "E2-005"
          ]
        }
      ]
    },
    {
      "id": "E3",
      "path": "docs/prd/PRD-E3-isolated-controlled-runner.md",
      "adr_ids": [
        "ADR-0008"
      ],
      "requirement_count": 5,
      "acceptance_ids": [
        "AC-E3-1",
        "AC-E3-2",
        "AC-E3-3",
        "AC-E3-4",
        "AC-E3-5"
      ],
      "ticket_ids": [
        "E3-001",
        "E3-002",
        "E3-003",
        "E3-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E3-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E3-1"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E3-2"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E3-3",
            "AC-E3-4"
          ]
        },
        {
          "requirement_key": "5",
          "acceptance_ids": [
            "AC-E3-3",
            "AC-E3-4",
            "AC-E3-5"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E3-1",
          "ticket_ids": [
            "E3-001",
            "E3-002"
          ]
        },
        {
          "acceptance_id": "AC-E3-2",
          "ticket_ids": [
            "E3-003"
          ]
        },
        {
          "acceptance_id": "AC-E3-3",
          "ticket_ids": [
            "E3-004"
          ]
        },
        {
          "acceptance_id": "AC-E3-4",
          "ticket_ids": [
            "E3-004"
          ]
        },
        {
          "acceptance_id": "AC-E3-5",
          "ticket_ids": [
            "E3-001",
            "E3-004"
          ]
        }
      ]
    },
    {
      "id": "E4",
      "path": "docs/prd/PRD-E4-codex-adapter.md",
      "adr_ids": [
        "ADR-0007"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E4-1",
        "AC-E4-2",
        "AC-E4-3",
        "AC-E4-4",
        "AC-E4-5"
      ],
      "ticket_ids": [
        "E4-001",
        "E4-002",
        "E4-003",
        "E4-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E4-1",
            "AC-E4-2",
            "AC-E4-3",
            "AC-E4-5"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E4-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E4-1"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E4-4",
            "AC-E4-5"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E4-1",
          "ticket_ids": [
            "E4-002",
            "E4-004"
          ]
        },
        {
          "acceptance_id": "AC-E4-2",
          "ticket_ids": [
            "E4-003"
          ]
        },
        {
          "acceptance_id": "AC-E4-3",
          "ticket_ids": [
            "E4-003"
          ]
        },
        {
          "acceptance_id": "AC-E4-4",
          "ticket_ids": [
            "E4-004"
          ]
        },
        {
          "acceptance_id": "AC-E4-5",
          "ticket_ids": [
            "E4-001",
            "E4-004"
          ]
        }
      ]
    },
    {
      "id": "E5",
      "path": "docs/prd/PRD-E5-fam4-loop-state-scenarios.md",
      "adr_ids": [
        "ADR-0009"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E5-1",
        "AC-E5-2",
        "AC-E5-3",
        "AC-E5-4"
      ],
      "ticket_ids": [
        "E5-001",
        "E5-002",
        "E5-003",
        "E5-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E5-4"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E5-1",
            "AC-E5-2",
            "AC-E5-3"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E5-4"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E5-1",
            "AC-E5-2",
            "AC-E5-3"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E5-1",
          "ticket_ids": [
            "E5-002"
          ]
        },
        {
          "acceptance_id": "AC-E5-2",
          "ticket_ids": [
            "E5-003"
          ]
        },
        {
          "acceptance_id": "AC-E5-3",
          "ticket_ids": [
            "E5-004"
          ]
        },
        {
          "acceptance_id": "AC-E5-4",
          "ticket_ids": [
            "E5-001"
          ]
        }
      ]
    },
    {
      "id": "E6",
      "path": "docs/prd/PRD-E6-fam5-false-completion-scenarios.md",
      "adr_ids": [
        "ADR-0005",
        "ADR-0006",
        "ADR-0009"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E6-1",
        "AC-E6-2",
        "AC-E6-3",
        "AC-E6-4"
      ],
      "ticket_ids": [
        "E6-001",
        "E6-002",
        "E6-003",
        "E6-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E6-1",
            "AC-E6-4"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E6-3"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E6-1",
            "AC-E6-2"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E6-2"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E6-1",
          "ticket_ids": [
            "E6-001"
          ]
        },
        {
          "acceptance_id": "AC-E6-2",
          "ticket_ids": [
            "E6-003"
          ]
        },
        {
          "acceptance_id": "AC-E6-3",
          "ticket_ids": [
            "E6-002"
          ]
        },
        {
          "acceptance_id": "AC-E6-4",
          "ticket_ids": [
            "E6-004"
          ]
        }
      ]
    },
    {
      "id": "E7",
      "path": "docs/prd/PRD-E7-fam6-recovery-safety-efficiency-and-g0.md",
      "adr_ids": [
        "ADR-0005",
        "ADR-0008",
        "ADR-0011"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E7-1",
        "AC-E7-2",
        "AC-E7-3",
        "AC-E7-4"
      ],
      "ticket_ids": [
        "E7-001",
        "E7-002",
        "E7-003",
        "E7-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E7-3"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E7-1",
            "AC-E7-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E7-4"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E7-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E7-1",
          "ticket_ids": [
            "E7-002"
          ]
        },
        {
          "acceptance_id": "AC-E7-2",
          "ticket_ids": [
            "E7-003"
          ]
        },
        {
          "acceptance_id": "AC-E7-3",
          "ticket_ids": [
            "E7-001"
          ]
        },
        {
          "acceptance_id": "AC-E7-4",
          "ticket_ids": [
            "E7-004"
          ]
        }
      ]
    },
    {
      "id": "E8",
      "path": "docs/prd/PRD-E8-fam1-3-and-form-a.md",
      "adr_ids": [
        "ADR-0009"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E8-1",
        "AC-E8-2",
        "AC-E8-3",
        "AC-E8-4"
      ],
      "ticket_ids": [
        "E8-001",
        "E8-002",
        "E8-003",
        "E8-004"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E8-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E8-1"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E8-2",
            "AC-E8-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E8-3",
            "AC-E8-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E8-1",
          "ticket_ids": [
            "E8-001",
            "E8-002",
            "E8-003"
          ]
        },
        {
          "acceptance_id": "AC-E8-2",
          "ticket_ids": [
            "E8-004"
          ]
        },
        {
          "acceptance_id": "AC-E8-3",
          "ticket_ids": [
            "E8-004"
          ]
        },
        {
          "acceptance_id": "AC-E8-4",
          "ticket_ids": [
            "E8-004"
          ]
        }
      ]
    },
    {
      "id": "E9",
      "path": "docs/prd/PRD-E9-claude-code-adapter-and-parity.md",
      "adr_ids": [
        "ADR-0007"
      ],
      "requirement_count": 4,
      "acceptance_ids": [
        "AC-E9-1",
        "AC-E9-2",
        "AC-E9-3",
        "AC-E9-4",
        "AC-E9-5"
      ],
      "ticket_ids": [
        "E9-001",
        "E9-002",
        "E9-003"
      ],
      "requirement_to_acceptance": [
        {
          "requirement_key": "1",
          "acceptance_ids": [
            "AC-E9-1",
            "AC-E9-5"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E9-4"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E9-2",
            "AC-E9-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E9-5"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E9-1",
          "ticket_ids": [
            "E9-001"
          ]
        },
        {
          "acceptance_id": "AC-E9-2",
          "ticket_ids": [
            "E9-003"
          ]
        },
        {
          "acceptance_id": "AC-E9-3",
          "ticket_ids": [
            "E9-003"
          ]
        },
        {
          "acceptance_id": "AC-E9-4",
          "ticket_ids": [
            "E9-002"
          ]
        },
        {
          "acceptance_id": "AC-E9-5",
          "ticket_ids": [
            "E9-001",
            "E9-002"
          ]
        }
      ]
    }
  ],
  "planned_tests": [
    {
      "path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "complete",
        "config-redaction",
        "forbidden-internal-source",
        "lifecycle",
        "limited",
        "missing-required",
        "official-source-boundary",
        "unknown"
      ]
    },
    {
      "path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "actor-attribution-events",
        "delegation-gap",
        "missing-parent",
        "oversized",
        "secret-canary",
        "semantic-events",
        "tool-error"
      ]
    },
    {
      "path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "complete",
        "config-redaction",
        "forbidden-source",
        "installed-schema-digest",
        "limited",
        "missing-required",
        "stable-digest",
        "unknown"
      ]
    },
    {
      "path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "blocked",
        "complete",
        "degraded",
        "digest-change",
        "event-missing",
        "imported"
      ]
    },
    {
      "path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "capability-digest",
        "double-stop",
        "lifecycle-happy",
        "primary-source-boundary",
        "start-fail",
        "stop-timeout"
      ]
    },
    {
      "path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "actor-attribution-events",
        "event-parity",
        "missing-parent",
        "oversized",
        "secret-canary",
        "tool-error",
        "unknown-native"
      ]
    },
    {
      "path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "approval",
        "evidence",
        "intervention",
        "lifecycle",
        "profile-difference",
        "tool-error",
        "unavailable-difference"
      ]
    },
    {
      "path": "conformance/demos/demo.test.ts",
      "cases": [
        "byte-stable",
        "claim-scan",
        "each-demo",
        "no-private-data",
        "stale-manifest"
      ]
    },
    {
      "path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "exact-bytes",
        "full-pass",
        "independent-manifest",
        "stale-head",
        "unresolved-gate",
        "wrong-digest"
      ]
    },
    {
      "path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "false-pass",
        "honest-blocked",
        "honest-fail",
        "honest-pass",
        "no-claim-terminal",
        "stale-pass"
      ]
    },
    {
      "path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "eligibility",
        "exposure",
        "prescription-path",
        "required-core",
        "six-family-census",
        "terminal-integrity",
        "timing"
      ]
    },
    {
      "path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "answer-leak",
        "construct-link",
        "repeated-form",
        "repo-distance",
        "trap-distance",
        "valid-B"
      ]
    },
    {
      "path": "conformance/g0/g0.test.ts",
      "cases": [
        "byte-drift",
        "one-mutant-live",
        "pass",
        "stale-digest",
        "zero-fixture"
      ]
    },
    {
      "path": "packages/reporter/test/diagnosis.test.ts",
      "cases": [
        "evidence-missing",
        "manual-review",
        "ordinary",
        "prohibited-copy",
        "safety-remediation"
      ]
    },
    {
      "path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "missing-event",
        "secret-canary",
        "stale-digest",
        "traversal",
        "valid-chain",
        "wrong-run"
      ]
    },
    {
      "path": "packages/reporter/test/preflight-report.test.ts",
      "cases": [
        "digest-mismatch",
        "each-threshold-fail",
        "pass-golden",
        "stable-bytes"
      ]
    },
    {
      "path": "packages/reporter/test/report.test.ts",
      "cases": [
        "S1-warning",
        "insufficient",
        "invalid",
        "issuable",
        "profile-unmatched",
        "stable-bytes",
        "unsafe"
      ]
    },
    {
      "path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "allowlist",
        "explicit-only",
        "no-network",
        "private-canaries",
        "stable-bytes",
        "unknown-field"
      ]
    },
    {
      "path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "copy-scan",
        "no-percentile",
        "no-provisional",
        "no-safe",
        "no-score",
        "valid",
        "watermark"
      ]
    },
    {
      "path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "blinding",
        "consent-block",
        "counterbalance",
        "deviation",
        "dry-run",
        "feasibility-claim-block",
        "immutable-row",
        "missingness"
      ]
    },
    {
      "path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "approval-deny",
        "concurrent-budget",
        "duplicate-effect",
        "refund",
        "seed-replay",
        "timeout"
      ]
    },
    {
      "path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "child-inherit",
        "env-secret",
        "fd-leak",
        "ipc-leak",
        "oracle-path",
        "post-run-materialization",
        "proc-fd-oracle",
        "redaction",
        "symlink-oracle",
        "temp-oracle"
      ]
    },
    {
      "path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "all-terminal-states",
        "cancel-race",
        "final-checkpoint",
        "illegal-transition",
        "orphan",
        "stall",
        "timeout",
        "unknown-attribution-terminal-outcome"
      ]
    },
    {
      "path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "duplicate-opportunity",
        "exposure-missing",
        "late-edit",
        "oracle-visible",
        "over-primary",
        "valid"
      ]
    },
    {
      "path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "baseline-mutation",
        "close-state",
        "deviation",
        "local-only",
        "one-treatment",
        "two-treatment"
      ]
    },
    {
      "path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "actor-attribution-classification",
        "dirty-base",
        "fresh",
        "residue",
        "source-mutation",
        "symlink-escape",
        "wrong-root"
      ]
    },
    {
      "path": "packages/schema/test/capability.test.ts",
      "cases": [
        "complete-matrix",
        "invalid-derived",
        "invalid-status",
        "missing-row",
        "missing-source"
      ]
    },
    {
      "path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "breaking-minor",
        "cross-node",
        "digest-mismatch",
        "negative-corpus",
        "valid-corpus",
        "zero-fixture"
      ]
    },
    {
      "path": "packages/schema/test/doctor-contract.test.ts",
      "cases": [
        "blocked",
        "complete",
        "degraded",
        "imported-only",
        "stable-order"
      ]
    },
    {
      "path": "packages/schema/test/issuance-contract.test.ts",
      "cases": [
        "NOT_OBSERVED-not-zero",
        "all-gates-pass",
        "one-negative-case-per-gate"
      ]
    },
    {
      "path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "canonical-pass-partial-fail-no-vectors",
        "complete-contract-v1-fields",
        "exact-20",
        "m03-precision-recall-f1-vectors",
        "m10-route-table-derived-regret",
        "m20-frontier-derived-distance",
        "reject-M21",
        "reject-caller-supplied-derived-m10-m20-values",
        "reject-dead-route",
        "reject-duplicate",
        "reject-gap"
      ]
    },
    {
      "path": "packages/schema/test/prescription-input.test.ts",
      "cases": [
        "missing-formula",
        "one-case-per-input",
        "range",
        "unknown-source",
        "version"
      ]
    },
    {
      "path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "estimate",
        "insufficient",
        "invalid",
        "issuable",
        "missing-profile",
        "percentile-reject",
        "stable-bytes",
        "unknown-attribution-withholds-score",
        "unsafe"
      ]
    },
    {
      "path": "packages/schema/test/scoring-contract.test.ts",
      "cases": [
        "O-zero",
        "P-zero",
        "S2-withhold",
        "published-vectors",
        "rounding-boundaries"
      ]
    },
    {
      "path": "packages/schema/test/session-class.test.ts",
      "cases": [
        "controlled-complete",
        "identity-gap",
        "imported",
        "missing-end",
        "missing-start"
      ]
    },
    {
      "path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "actor-attribution-events",
        "all-events",
        "bad-parent",
        "missing-id",
        "oversized",
        "secret-canary",
        "stable-bytes",
        "unknown-attribution-requires-confidence-drop",
        "unknown-event"
      ]
    },
    {
      "path": "packages/schema/test/treatment-registry.test.ts",
      "cases": [
        "S2-remediation",
        "coverage-M01-M20",
        "missing-retest",
        "unique-default",
        "unknown-metric"
      ]
    },
    {
      "path": "packages/scorer/test/eligibility.test.ts",
      "cases": [
        "duplicate-correlation",
        "independent-two",
        "no-opportunity",
        "secondary-without-opportunity",
        "unavailable-adapter"
      ]
    },
    {
      "path": "packages/scorer/test/fixture-corpus.test.ts",
      "cases": [
        "digest-manifest",
        "each-family",
        "fixture-census",
        "mutation-survives",
        "no-answer-leak"
      ]
    },
    {
      "path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "S0",
        "S1",
        "S2",
        "S3",
        "adapter-gap",
        "one-case-per-ten-gates",
        "reason-order",
        "tamper"
      ]
    },
    {
      "path": "packages/scorer/test/pack-budget.test.ts",
      "cases": [
        "double-count",
        "no-prescription",
        "slow-pack",
        "under-observed",
        "valid-pack"
      ]
    },
    {
      "path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "combined",
        "environment",
        "exposure",
        "operator",
        "positive",
        "unclassified",
        "unsafe",
        "verification-degrade"
      ]
    },
    {
      "path": "packages/scorer/test/score.test.ts",
      "cases": [
        "F6-M20-only",
        "O-zero",
        "P-zero",
        "missing-denominator",
        "published-vectors",
        "raw-precision"
      ]
    },
    {
      "path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "S2",
        "factor-priority",
        "insufficient",
        "lower-cost",
        "lower-permission",
        "manual-review",
        "three-point-tie"
      ]
    },
    {
      "path": "packages/scorer/test/simulation-input.test.ts",
      "cases": [
        "duplicate-opportunity",
        "missing-threshold",
        "over-four-primary",
        "unregistered-policy",
        "valid-input"
      ]
    },
    {
      "path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "agreement-low",
        "duration-fail",
        "feasibility-only-verdicts",
        "incomplete",
        "known-vectors",
        "noise-dominant",
        "person-signal",
        "transfer-fail"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "acceptance-map",
        "goal-fidelity",
        "hidden-outcome",
        "necessary-ask",
        "scope",
        "unnecessary-ask"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "citation-grounding",
        "decoy-precision",
        "gold-recall",
        "injection",
        "no-retrieval",
        "stale"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "atomicity",
        "direct-best",
        "false-parallel",
        "join-integrity",
        "specialist-best",
        "valid-parallel"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam4-continuity.test.ts",
      "cases": [
        "fresh-resume",
        "missing-blocker",
        "stale-checkpoint",
        "valid-alternative",
        "wrong-evidence"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam4-idempotency.test.ts",
      "cases": [
        "duplicate-effect",
        "illegal-transition",
        "single-effect",
        "stale-ack",
        "wrong-key"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam4-stall.test.ts",
      "cases": [
        "budget-overrun",
        "detect",
        "false-complete",
        "valid-blocked",
        "wrong-stop"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam5-false-completion.test.ts",
      "cases": [
        "honest-fail",
        "oracle-access",
        "public-green-hidden-fail",
        "true-pass"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "broad-rewrite",
        "extra-path",
        "in-scope-pass",
        "omission",
        "regression",
        "wrong-target"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam5-stale-evidence.test.ts",
      "cases": [
        "exact-head-pass",
        "partial-rerun",
        "pre-change-stale",
        "timestamp-only",
        "wrong-artifact"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "cheap-fail",
        "human-time",
        "missing-token",
        "pareto-best",
        "redundant-layer",
        "unsafe-cheap"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "bad-fallback",
        "human-decision",
        "minimum-recovery",
        "permanent-fail",
        "rate-limit",
        "timeout"
      ]
    },
    {
      "path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "S0",
        "S1",
        "S2",
        "S3",
        "over-privilege",
        "over-restrict",
        "wrong-target"
      ]
    },
    {
      "path": "tests/execution-state.test.mjs",
      "cases": [
        "actor-policy-missing-or-malformed",
        "board-is-not-an-input",
        "bootstrap-after-c-fails-closed",
        "candidate-ci-candidate-workflow-differs-from-live-target-is-blocked",
        "candidate-ci-missing-stale-or-wrong-head-is-blocked",
        "candidate-ci-required-set-is-exact",
        "candidate-ci-wrong-app-event-base-path-or-run-is-blocked",
        "candidate-controlled-or-non-ancestor-review-workflow-is-blocked",
        "current-baseline-state",
        "current-head-is-runtime-derived",
        "current-review-without-authorization-is-blocked",
        "exact-base-packet-requires-ready",
        "external-unavailable-yields-unknown",
        "future-check-premature",
        "gate-pr-stale-head-or-digest",
        "gate-pr-wrong-or-no-longer-owner-actor",
        "generated-views-are-deterministic",
        "issue-label-is-not-an-input",
        "post-merge-ci-required",
        "projection-drift-does-not-change-state",
        "ready-authorizes-packet-not-red",
        "registry-string-is-not-gate-acceptance",
        "review-and-authorization-are-distinct",
        "roadmap-is-not-an-input",
        "single-owner-sequential-review-and-authorization",
        "single-owner-spoof-is-not-authorization",
        "stale-digest-removes-readiness",
        "wrong-check-creator-or-external-id-is-blocked",
        "wrong-dispatch-permission-is-blocked",
        "wrong-repository-or-branch-fails-closed",
        "wrong-workflow-blob-or-run-provenance-is-blocked"
      ]
    },
    {
      "path": "tests/planning-contract.test.mjs",
      "cases": [
        "computed-product-code-census",
        "d0-003-historical-pr53-boundary",
        "encoded-path-root-resolution",
        "identity-consistency-and-no-exception",
        "issue-map-and-manifest-agreement",
        "maintainer-gate-digest-invalidation",
        "operational-authority-schema-and-ticket-agreement",
        "orphan-requirement-ac-ticket-test-mutants",
        "semantic-traceability-graph",
        "superseded-d0-003-has-no-owned-implementation"
      ]
    },
    {
      "path": "tests/planning/identity.test.mjs",
      "cases": [
        "canonical-pass",
        "case-word-boundary-variants",
        "each-forbidden-token",
        "no-active-tree-exception",
        "npm-test-discovers-identity",
        "wrong-target-no-silent-fallback"
      ]
    },
    {
      "path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "engine-matrix",
        "minimum-name-clearance",
        "one-owner-per-path",
        "root-private-and-internal-workspaces-private",
        "root-private-scripts-and-runnable-surface",
        "workspace-census",
        "workspace-lock-consistency"
      ]
    },
    {
      "path": "tests/publication/clearance.test.mjs",
      "cases": [
        "contributor",
        "license",
        "license-contribution-redistribution",
        "notices",
        "security",
        "unresolved-block"
      ]
    },
    {
      "path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "commands",
        "links",
        "no-answers",
        "no-attribution",
        "no-claims",
        "no-secrets",
        "telemetry-off"
      ]
    },
    {
      "path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "blind-review",
        "feasibility-only-verdicts",
        "hypotheses",
        "missingness",
        "no-percentile",
        "sample-balance",
        "schema",
        "stop-rules"
      ]
    }
  ],
  "ticket_acceptance_bindings": [
    {
      "ticket_id": "D0-001",
      "acceptance_id": "AC-D0-001-1",
      "test_path": "tests/planning/identity.test.mjs",
      "cases": [
        "canonical-pass"
      ]
    },
    {
      "ticket_id": "D0-001",
      "acceptance_id": "AC-D0-001-2",
      "test_path": "tests/planning/identity.test.mjs",
      "cases": [
        "each-forbidden-token"
      ]
    },
    {
      "ticket_id": "D0-001",
      "acceptance_id": "AC-D0-001-3",
      "test_path": "tests/planning/identity.test.mjs",
      "cases": [
        "no-active-tree-exception"
      ]
    },
    {
      "ticket_id": "D0-001",
      "acceptance_id": "AC-D0-001-4",
      "test_path": "tests/planning/identity.test.mjs",
      "cases": [
        "case-word-boundary-variants"
      ]
    },
    {
      "ticket_id": "D0-001",
      "acceptance_id": "AC-D0-001-5",
      "test_path": "tests/planning/identity.test.mjs",
      "cases": [
        "wrong-target-no-silent-fallback"
      ]
    },
    {
      "ticket_id": "D0-001",
      "acceptance_id": "AC-D0-001-6",
      "test_path": "tests/planning/identity.test.mjs",
      "cases": [
        "npm-test-discovers-identity"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-1",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "workspace-census"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-2",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "root-private-and-internal-workspaces-private"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-3",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "one-owner-per-path"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-4",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "root-private-scripts-and-runnable-surface"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-5",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "engine-matrix"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-6",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "minimum-name-clearance"
      ]
    },
    {
      "ticket_id": "D0-002",
      "acceptance_id": "AC-D0-002-7",
      "test_path": "tests/planning/workspace-skeleton.test.mjs",
      "cases": [
        "workspace-lock-consistency"
      ]
    },
    {
      "ticket_id": "D0-003",
      "acceptance_id": "AC-D0-003-1",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "d0-003-historical-pr53-boundary"
      ]
    },
    {
      "ticket_id": "D0-003",
      "acceptance_id": "AC-D0-003-2",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "superseded-d0-003-has-no-owned-implementation"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-1",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "semantic-traceability-graph"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-10",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "external-unavailable-yields-unknown",
        "wrong-repository-or-branch-fails-closed"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-11",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "roadmap-is-not-an-input",
        "board-is-not-an-input",
        "issue-label-is-not-an-input"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-12",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "generated-views-are-deterministic",
        "projection-drift-does-not-change-state"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-13",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "exact-base-packet-requires-ready"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-14",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "registry-string-is-not-gate-acceptance",
        "actor-policy-missing-or-malformed",
        "gate-pr-wrong-or-no-longer-owner-actor",
        "gate-pr-stale-head-or-digest"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-15",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "review-and-authorization-are-distinct",
        "current-review-without-authorization-is-blocked",
        "single-owner-spoof-is-not-authorization",
        "single-owner-sequential-review-and-authorization",
        "candidate-controlled-or-non-ancestor-review-workflow-is-blocked",
        "wrong-workflow-blob-or-run-provenance-is-blocked",
        "wrong-check-creator-or-external-id-is-blocked",
        "wrong-dispatch-permission-is-blocked"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-16",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "ready-authorizes-packet-not-red"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-17",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "candidate-ci-required-set-is-exact",
        "candidate-ci-missing-stale-or-wrong-head-is-blocked",
        "candidate-ci-wrong-app-event-base-path-or-run-is-blocked",
        "candidate-ci-candidate-workflow-differs-from-live-target-is-blocked"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-18",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "future-check-premature",
        "bootstrap-after-c-fails-closed"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-2",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "orphan-requirement-ac-ticket-test-mutants"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-3",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "issue-map-and-manifest-agreement",
        "operational-authority-schema-and-ticket-agreement"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-4",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "maintainer-gate-digest-invalidation"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-5",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "computed-product-code-census"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-6",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "identity-consistency-and-no-exception"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-7",
      "test_path": "tests/planning-contract.test.mjs",
      "cases": [
        "encoded-path-root-resolution"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-8",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "current-baseline-state",
        "current-head-is-runtime-derived"
      ]
    },
    {
      "ticket_id": "D0-004",
      "acceptance_id": "AC-D0-004-9",
      "test_path": "tests/execution-state.test.mjs",
      "cases": [
        "post-merge-ci-required",
        "stale-digest-removes-readiness"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-1",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "exact-20"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-10",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "m20-frontier-derived-distance"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-11",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "reject-caller-supplied-derived-m10-m20-values"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-2",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "reject-M21"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-3",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "reject-gap"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-4",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "reject-duplicate"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-5",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "reject-dead-route"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-6",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "complete-contract-v1-fields"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-7",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "m03-precision-recall-f1-vectors"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-8",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "canonical-pass-partial-fail-no-vectors"
      ]
    },
    {
      "ticket_id": "E0A-001",
      "acceptance_id": "AC-E0A-001-9",
      "test_path": "packages/schema/test/metric-registry.test.ts",
      "cases": [
        "m10-route-table-derived-regret"
      ]
    },
    {
      "ticket_id": "E0A-002",
      "acceptance_id": "AC-E0A-002-1",
      "test_path": "packages/schema/test/issuance-contract.test.ts",
      "cases": [
        "one-negative-case-per-gate"
      ]
    },
    {
      "ticket_id": "E0A-002",
      "acceptance_id": "AC-E0A-002-2",
      "test_path": "packages/schema/test/issuance-contract.test.ts",
      "cases": [
        "all-gates-pass"
      ]
    },
    {
      "ticket_id": "E0A-002",
      "acceptance_id": "AC-E0A-002-3",
      "test_path": "packages/schema/test/issuance-contract.test.ts",
      "cases": [
        "NOT_OBSERVED-not-zero"
      ]
    },
    {
      "ticket_id": "E0A-003",
      "acceptance_id": "AC-E0A-003-1",
      "test_path": "packages/schema/test/scoring-contract.test.ts",
      "cases": [
        "published-vectors"
      ]
    },
    {
      "ticket_id": "E0A-003",
      "acceptance_id": "AC-E0A-003-2",
      "test_path": "packages/schema/test/scoring-contract.test.ts",
      "cases": [
        "O-zero"
      ]
    },
    {
      "ticket_id": "E0A-003",
      "acceptance_id": "AC-E0A-003-3",
      "test_path": "packages/schema/test/scoring-contract.test.ts",
      "cases": [
        "P-zero"
      ]
    },
    {
      "ticket_id": "E0A-003",
      "acceptance_id": "AC-E0A-003-4",
      "test_path": "packages/schema/test/scoring-contract.test.ts",
      "cases": [
        "S2-withhold"
      ]
    },
    {
      "ticket_id": "E0A-003",
      "acceptance_id": "AC-E0A-003-5",
      "test_path": "packages/schema/test/scoring-contract.test.ts",
      "cases": [
        "rounding-boundaries"
      ]
    },
    {
      "ticket_id": "E0B-001",
      "acceptance_id": "AC-E0B-001-1",
      "test_path": "packages/schema/test/capability.test.ts",
      "cases": [
        "complete-matrix"
      ]
    },
    {
      "ticket_id": "E0B-001",
      "acceptance_id": "AC-E0B-001-2",
      "test_path": "packages/schema/test/capability.test.ts",
      "cases": [
        "missing-row"
      ]
    },
    {
      "ticket_id": "E0B-001",
      "acceptance_id": "AC-E0B-001-3",
      "test_path": "packages/schema/test/capability.test.ts",
      "cases": [
        "missing-source"
      ]
    },
    {
      "ticket_id": "E0B-001",
      "acceptance_id": "AC-E0B-001-4",
      "test_path": "packages/schema/test/capability.test.ts",
      "cases": [
        "invalid-derived"
      ]
    },
    {
      "ticket_id": "E0B-001",
      "acceptance_id": "AC-E0B-001-5",
      "test_path": "packages/schema/test/capability.test.ts",
      "cases": [
        "invalid-status"
      ]
    },
    {
      "ticket_id": "E0B-002",
      "acceptance_id": "AC-E0B-002-1",
      "test_path": "packages/schema/test/session-class.test.ts",
      "cases": [
        "controlled-complete"
      ]
    },
    {
      "ticket_id": "E0B-002",
      "acceptance_id": "AC-E0B-002-2",
      "test_path": "packages/schema/test/session-class.test.ts",
      "cases": [
        "missing-start"
      ]
    },
    {
      "ticket_id": "E0B-002",
      "acceptance_id": "AC-E0B-002-3",
      "test_path": "packages/schema/test/session-class.test.ts",
      "cases": [
        "missing-end"
      ]
    },
    {
      "ticket_id": "E0B-002",
      "acceptance_id": "AC-E0B-002-4",
      "test_path": "packages/schema/test/session-class.test.ts",
      "cases": [
        "imported"
      ]
    },
    {
      "ticket_id": "E0B-002",
      "acceptance_id": "AC-E0B-002-5",
      "test_path": "packages/schema/test/session-class.test.ts",
      "cases": [
        "identity-gap"
      ]
    },
    {
      "ticket_id": "E0B-003",
      "acceptance_id": "AC-E0B-003-1",
      "test_path": "packages/schema/test/doctor-contract.test.ts",
      "cases": [
        "complete"
      ]
    },
    {
      "ticket_id": "E0B-003",
      "acceptance_id": "AC-E0B-003-2",
      "test_path": "packages/schema/test/doctor-contract.test.ts",
      "cases": [
        "degraded"
      ]
    },
    {
      "ticket_id": "E0B-003",
      "acceptance_id": "AC-E0B-003-3",
      "test_path": "packages/schema/test/doctor-contract.test.ts",
      "cases": [
        "blocked"
      ]
    },
    {
      "ticket_id": "E0B-003",
      "acceptance_id": "AC-E0B-003-4",
      "test_path": "packages/schema/test/doctor-contract.test.ts",
      "cases": [
        "imported-only"
      ]
    },
    {
      "ticket_id": "E0B-003",
      "acceptance_id": "AC-E0B-003-5",
      "test_path": "packages/schema/test/doctor-contract.test.ts",
      "cases": [
        "stable-order"
      ]
    },
    {
      "ticket_id": "E0C-001",
      "acceptance_id": "AC-E0C-001-1",
      "test_path": "packages/scorer/test/simulation-input.test.ts",
      "cases": [
        "valid-input"
      ]
    },
    {
      "ticket_id": "E0C-001",
      "acceptance_id": "AC-E0C-001-2",
      "test_path": "packages/scorer/test/simulation-input.test.ts",
      "cases": [
        "over-four-primary"
      ]
    },
    {
      "ticket_id": "E0C-001",
      "acceptance_id": "AC-E0C-001-3",
      "test_path": "packages/scorer/test/simulation-input.test.ts",
      "cases": [
        "duplicate-opportunity"
      ]
    },
    {
      "ticket_id": "E0C-001",
      "acceptance_id": "AC-E0C-001-4",
      "test_path": "packages/scorer/test/simulation-input.test.ts",
      "cases": [
        "missing-threshold"
      ]
    },
    {
      "ticket_id": "E0C-001",
      "acceptance_id": "AC-E0C-001-5",
      "test_path": "packages/scorer/test/simulation-input.test.ts",
      "cases": [
        "unregistered-policy"
      ]
    },
    {
      "ticket_id": "E0C-002",
      "acceptance_id": "AC-E0C-002-1",
      "test_path": "packages/scorer/test/pack-budget.test.ts",
      "cases": [
        "valid-pack"
      ]
    },
    {
      "ticket_id": "E0C-002",
      "acceptance_id": "AC-E0C-002-2",
      "test_path": "packages/scorer/test/pack-budget.test.ts",
      "cases": [
        "slow-pack"
      ]
    },
    {
      "ticket_id": "E0C-002",
      "acceptance_id": "AC-E0C-002-3",
      "test_path": "packages/scorer/test/pack-budget.test.ts",
      "cases": [
        "under-observed"
      ]
    },
    {
      "ticket_id": "E0C-002",
      "acceptance_id": "AC-E0C-002-4",
      "test_path": "packages/scorer/test/pack-budget.test.ts",
      "cases": [
        "double-count"
      ]
    },
    {
      "ticket_id": "E0C-002",
      "acceptance_id": "AC-E0C-002-5",
      "test_path": "packages/scorer/test/pack-budget.test.ts",
      "cases": [
        "no-prescription"
      ]
    },
    {
      "ticket_id": "E0C-003",
      "acceptance_id": "AC-E0C-003-1",
      "test_path": "packages/reporter/test/preflight-report.test.ts",
      "cases": [
        "pass-golden"
      ]
    },
    {
      "ticket_id": "E0C-003",
      "acceptance_id": "AC-E0C-003-2",
      "test_path": "packages/reporter/test/preflight-report.test.ts",
      "cases": [
        "each-threshold-fail"
      ]
    },
    {
      "ticket_id": "E0C-003",
      "acceptance_id": "AC-E0C-003-3",
      "test_path": "packages/reporter/test/preflight-report.test.ts",
      "cases": [
        "digest-mismatch"
      ]
    },
    {
      "ticket_id": "E0C-003",
      "acceptance_id": "AC-E0C-003-4",
      "test_path": "packages/reporter/test/preflight-report.test.ts",
      "cases": [
        "stable-bytes"
      ]
    },
    {
      "ticket_id": "E0D-001",
      "acceptance_id": "AC-E0D-001-1",
      "test_path": "packages/schema/test/prescription-input.test.ts",
      "cases": [
        "one-case-per-input"
      ]
    },
    {
      "ticket_id": "E0D-001",
      "acceptance_id": "AC-E0D-001-2",
      "test_path": "packages/schema/test/prescription-input.test.ts",
      "cases": [
        "missing-formula"
      ]
    },
    {
      "ticket_id": "E0D-001",
      "acceptance_id": "AC-E0D-001-3",
      "test_path": "packages/schema/test/prescription-input.test.ts",
      "cases": [
        "range"
      ]
    },
    {
      "ticket_id": "E0D-001",
      "acceptance_id": "AC-E0D-001-4",
      "test_path": "packages/schema/test/prescription-input.test.ts",
      "cases": [
        "unknown-source"
      ]
    },
    {
      "ticket_id": "E0D-001",
      "acceptance_id": "AC-E0D-001-5",
      "test_path": "packages/schema/test/prescription-input.test.ts",
      "cases": [
        "version"
      ]
    },
    {
      "ticket_id": "E0D-002",
      "acceptance_id": "AC-E0D-002-1",
      "test_path": "packages/schema/test/treatment-registry.test.ts",
      "cases": [
        "coverage-M01-M20"
      ]
    },
    {
      "ticket_id": "E0D-002",
      "acceptance_id": "AC-E0D-002-2",
      "test_path": "packages/schema/test/treatment-registry.test.ts",
      "cases": [
        "unique-default"
      ]
    },
    {
      "ticket_id": "E0D-002",
      "acceptance_id": "AC-E0D-002-3",
      "test_path": "packages/schema/test/treatment-registry.test.ts",
      "cases": [
        "S2-remediation"
      ]
    },
    {
      "ticket_id": "E0D-002",
      "acceptance_id": "AC-E0D-002-4",
      "test_path": "packages/schema/test/treatment-registry.test.ts",
      "cases": [
        "missing-retest"
      ]
    },
    {
      "ticket_id": "E0D-002",
      "acceptance_id": "AC-E0D-002-5",
      "test_path": "packages/schema/test/treatment-registry.test.ts",
      "cases": [
        "unknown-metric"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-1",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "S2"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-2",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "factor-priority"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-3",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "three-point-tie"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-4",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "lower-cost"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-5",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "lower-permission"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-6",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "insufficient"
      ]
    },
    {
      "ticket_id": "E0D-003",
      "acceptance_id": "AC-E0D-003-7",
      "test_path": "packages/scorer/test/select-lever.test.ts",
      "cases": [
        "manual-review"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-1",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "all-events"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-2",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "missing-id"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-3",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "bad-parent"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-4",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "oversized"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-5",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "secret-canary"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-6",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "unknown-event"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-7",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "stable-bytes"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-8",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "actor-attribution-events"
      ]
    },
    {
      "ticket_id": "E1-001",
      "acceptance_id": "AC-E1-001-9",
      "test_path": "packages/schema/test/trace-schema.test.ts",
      "cases": [
        "unknown-attribution-requires-confidence-drop"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-1",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "issuable"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-2",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "estimate"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-3",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "insufficient"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-4",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "unsafe"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-5",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "invalid"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-6",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "missing-profile"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-7",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "percentile-reject"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-8",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "stable-bytes"
      ]
    },
    {
      "ticket_id": "E1-002",
      "acceptance_id": "AC-E1-002-9",
      "test_path": "packages/schema/test/result-schema.test.ts",
      "cases": [
        "unknown-attribution-withholds-score"
      ]
    },
    {
      "ticket_id": "E1-003",
      "acceptance_id": "AC-E1-003-1",
      "test_path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "zero-fixture"
      ]
    },
    {
      "ticket_id": "E1-003",
      "acceptance_id": "AC-E1-003-2",
      "test_path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "valid-corpus"
      ]
    },
    {
      "ticket_id": "E1-003",
      "acceptance_id": "AC-E1-003-3",
      "test_path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "negative-corpus"
      ]
    },
    {
      "ticket_id": "E1-003",
      "acceptance_id": "AC-E1-003-4",
      "test_path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "breaking-minor"
      ]
    },
    {
      "ticket_id": "E1-003",
      "acceptance_id": "AC-E1-003-5",
      "test_path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "digest-mismatch"
      ]
    },
    {
      "ticket_id": "E1-003",
      "acceptance_id": "AC-E1-003-6",
      "test_path": "packages/schema/test/conformance.test.ts",
      "cases": [
        "cross-node"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-1",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "issuable"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-2",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "S1-warning"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-3",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "insufficient"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-4",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "unsafe"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-5",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "invalid"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-6",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "profile-unmatched"
      ]
    },
    {
      "ticket_id": "E10-001",
      "acceptance_id": "AC-E10-001-7",
      "test_path": "packages/reporter/test/report.test.ts",
      "cases": [
        "stable-bytes"
      ]
    },
    {
      "ticket_id": "E10-002",
      "acceptance_id": "AC-E10-002-1",
      "test_path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "valid-chain"
      ]
    },
    {
      "ticket_id": "E10-002",
      "acceptance_id": "AC-E10-002-2",
      "test_path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "missing-event"
      ]
    },
    {
      "ticket_id": "E10-002",
      "acceptance_id": "AC-E10-002-3",
      "test_path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "stale-digest"
      ]
    },
    {
      "ticket_id": "E10-002",
      "acceptance_id": "AC-E10-002-4",
      "test_path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "traversal"
      ]
    },
    {
      "ticket_id": "E10-002",
      "acceptance_id": "AC-E10-002-5",
      "test_path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "wrong-run"
      ]
    },
    {
      "ticket_id": "E10-002",
      "acceptance_id": "AC-E10-002-6",
      "test_path": "packages/reporter/test/evidence-resolver.test.ts",
      "cases": [
        "secret-canary"
      ]
    },
    {
      "ticket_id": "E10-003",
      "acceptance_id": "AC-E10-003-1",
      "test_path": "packages/reporter/test/diagnosis.test.ts",
      "cases": [
        "ordinary"
      ]
    },
    {
      "ticket_id": "E10-003",
      "acceptance_id": "AC-E10-003-2",
      "test_path": "packages/reporter/test/diagnosis.test.ts",
      "cases": [
        "safety-remediation"
      ]
    },
    {
      "ticket_id": "E10-003",
      "acceptance_id": "AC-E10-003-3",
      "test_path": "packages/reporter/test/diagnosis.test.ts",
      "cases": [
        "manual-review"
      ]
    },
    {
      "ticket_id": "E10-003",
      "acceptance_id": "AC-E10-003-4",
      "test_path": "packages/reporter/test/diagnosis.test.ts",
      "cases": [
        "evidence-missing"
      ]
    },
    {
      "ticket_id": "E10-003",
      "acceptance_id": "AC-E10-003-5",
      "test_path": "packages/reporter/test/diagnosis.test.ts",
      "cases": [
        "prohibited-copy"
      ]
    },
    {
      "ticket_id": "E11-001",
      "acceptance_id": "AC-E11-001-1",
      "test_path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "construct-link"
      ]
    },
    {
      "ticket_id": "E11-001",
      "acceptance_id": "AC-E11-001-2",
      "test_path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "repo-distance"
      ]
    },
    {
      "ticket_id": "E11-001",
      "acceptance_id": "AC-E11-001-3",
      "test_path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "trap-distance"
      ]
    },
    {
      "ticket_id": "E11-001",
      "acceptance_id": "AC-E11-001-4",
      "test_path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "repeated-form"
      ]
    },
    {
      "ticket_id": "E11-001",
      "acceptance_id": "AC-E11-001-5",
      "test_path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "answer-leak"
      ]
    },
    {
      "ticket_id": "E11-001",
      "acceptance_id": "AC-E11-001-6",
      "test_path": "conformance/form-b/form-b.test.ts",
      "cases": [
        "valid-B"
      ]
    },
    {
      "ticket_id": "E11-002",
      "acceptance_id": "AC-E11-002-1",
      "test_path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "one-treatment"
      ]
    },
    {
      "ticket_id": "E11-002",
      "acceptance_id": "AC-E11-002-2",
      "test_path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "two-treatment"
      ]
    },
    {
      "ticket_id": "E11-002",
      "acceptance_id": "AC-E11-002-3",
      "test_path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "baseline-mutation"
      ]
    },
    {
      "ticket_id": "E11-002",
      "acceptance_id": "AC-E11-002-4",
      "test_path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "deviation"
      ]
    },
    {
      "ticket_id": "E11-002",
      "acceptance_id": "AC-E11-002-5",
      "test_path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "local-only"
      ]
    },
    {
      "ticket_id": "E11-002",
      "acceptance_id": "AC-E11-002-6",
      "test_path": "packages/runner/test/sprint-ledger.test.ts",
      "cases": [
        "close-state"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-1",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "operator"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-2",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "environment"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-3",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "combined"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-4",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "unclassified"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-5",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "verification-degrade"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-6",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "unsafe"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-7",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "exposure"
      ]
    },
    {
      "ticket_id": "E11-003",
      "acceptance_id": "AC-E11-003-8",
      "test_path": "packages/scorer/test/retest.test.ts",
      "cases": [
        "positive"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-1",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "schema"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-2",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "sample-balance"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-3",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "hypotheses"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-4",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "missingness"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-5",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "blind-review"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-6",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "stop-rules"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-7",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "no-percentile"
      ]
    },
    {
      "ticket_id": "E12-001",
      "acceptance_id": "AC-E12-001-8",
      "test_path": "tests/validation/alpha-protocol.test.mjs",
      "cases": [
        "feasibility-only-verdicts"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-1",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "dry-run"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-2",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "consent-block"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-3",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "immutable-row"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-4",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "missingness"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-5",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "counterbalance"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-6",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "blinding"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-7",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "deviation"
      ]
    },
    {
      "ticket_id": "E12-002",
      "acceptance_id": "AC-E12-002-8",
      "test_path": "packages/runner/test/alpha-orchestrator.test.ts",
      "cases": [
        "feasibility-claim-block"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-1",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "known-vectors"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-2",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "person-signal"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-3",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "noise-dominant"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-4",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "duration-fail"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-5",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "agreement-low"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-6",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "transfer-fail"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-7",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "incomplete"
      ]
    },
    {
      "ticket_id": "E12-003",
      "acceptance_id": "AC-E12-003-8",
      "test_path": "packages/scorer/test/validation.test.ts",
      "cases": [
        "feasibility-only-verdicts"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-1",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "valid"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-2",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "no-score"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-3",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "no-provisional"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-4",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "no-safe"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-5",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "no-percentile"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-6",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "watermark"
      ]
    },
    {
      "ticket_id": "E13-001",
      "acceptance_id": "AC-E13-001-7",
      "test_path": "packages/reporter/test/snapshot.test.ts",
      "cases": [
        "copy-scan"
      ]
    },
    {
      "ticket_id": "E13-002",
      "acceptance_id": "AC-E13-002-1",
      "test_path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "allowlist"
      ]
    },
    {
      "ticket_id": "E13-002",
      "acceptance_id": "AC-E13-002-2",
      "test_path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "unknown-field"
      ]
    },
    {
      "ticket_id": "E13-002",
      "acceptance_id": "AC-E13-002-3",
      "test_path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "private-canaries"
      ]
    },
    {
      "ticket_id": "E13-002",
      "acceptance_id": "AC-E13-002-4",
      "test_path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "explicit-only"
      ]
    },
    {
      "ticket_id": "E13-002",
      "acceptance_id": "AC-E13-002-5",
      "test_path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "no-network"
      ]
    },
    {
      "ticket_id": "E13-002",
      "acceptance_id": "AC-E13-002-6",
      "test_path": "packages/reporter/test/snapshot-share.test.ts",
      "cases": [
        "stable-bytes"
      ]
    },
    {
      "ticket_id": "E14-001",
      "acceptance_id": "AC-E14-001-1",
      "test_path": "tests/publication/clearance.test.mjs",
      "cases": [
        "license-contribution-redistribution"
      ]
    },
    {
      "ticket_id": "E14-001",
      "acceptance_id": "AC-E14-001-2",
      "test_path": "tests/publication/clearance.test.mjs",
      "cases": [
        "license"
      ]
    },
    {
      "ticket_id": "E14-001",
      "acceptance_id": "AC-E14-001-3",
      "test_path": "tests/publication/clearance.test.mjs",
      "cases": [
        "notices"
      ]
    },
    {
      "ticket_id": "E14-001",
      "acceptance_id": "AC-E14-001-4",
      "test_path": "tests/publication/clearance.test.mjs",
      "cases": [
        "contributor"
      ]
    },
    {
      "ticket_id": "E14-001",
      "acceptance_id": "AC-E14-001-5",
      "test_path": "tests/publication/clearance.test.mjs",
      "cases": [
        "security"
      ]
    },
    {
      "ticket_id": "E14-001",
      "acceptance_id": "AC-E14-001-6",
      "test_path": "tests/publication/clearance.test.mjs",
      "cases": [
        "unresolved-block"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-1",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "commands"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-2",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "links"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-3",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "no-claims"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-4",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "no-secrets"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-5",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "no-answers"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-6",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "no-attribution"
      ]
    },
    {
      "ticket_id": "E14-002",
      "acceptance_id": "AC-E14-002-7",
      "test_path": "tests/publication/public-surface.test.mjs",
      "cases": [
        "telemetry-off"
      ]
    },
    {
      "ticket_id": "E14-003",
      "acceptance_id": "AC-E14-003-1",
      "test_path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "independent-manifest"
      ]
    },
    {
      "ticket_id": "E14-003",
      "acceptance_id": "AC-E14-003-2",
      "test_path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "exact-bytes"
      ]
    },
    {
      "ticket_id": "E14-003",
      "acceptance_id": "AC-E14-003-3",
      "test_path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "wrong-digest"
      ]
    },
    {
      "ticket_id": "E14-003",
      "acceptance_id": "AC-E14-003-4",
      "test_path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "stale-head"
      ]
    },
    {
      "ticket_id": "E14-003",
      "acceptance_id": "AC-E14-003-5",
      "test_path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "unresolved-gate"
      ]
    },
    {
      "ticket_id": "E14-003",
      "acceptance_id": "AC-E14-003-6",
      "test_path": "conformance/external/external-reproduction.test.ts",
      "cases": [
        "full-pass"
      ]
    },
    {
      "ticket_id": "E2-001",
      "acceptance_id": "AC-E2-001-1",
      "test_path": "packages/scorer/test/eligibility.test.ts",
      "cases": [
        "no-opportunity"
      ]
    },
    {
      "ticket_id": "E2-001",
      "acceptance_id": "AC-E2-001-2",
      "test_path": "packages/scorer/test/eligibility.test.ts",
      "cases": [
        "independent-two"
      ]
    },
    {
      "ticket_id": "E2-001",
      "acceptance_id": "AC-E2-001-3",
      "test_path": "packages/scorer/test/eligibility.test.ts",
      "cases": [
        "duplicate-correlation"
      ]
    },
    {
      "ticket_id": "E2-001",
      "acceptance_id": "AC-E2-001-4",
      "test_path": "packages/scorer/test/eligibility.test.ts",
      "cases": [
        "secondary-without-opportunity"
      ]
    },
    {
      "ticket_id": "E2-001",
      "acceptance_id": "AC-E2-001-5",
      "test_path": "packages/scorer/test/eligibility.test.ts",
      "cases": [
        "unavailable-adapter"
      ]
    },
    {
      "ticket_id": "E2-002",
      "acceptance_id": "AC-E2-002-1",
      "test_path": "packages/scorer/test/score.test.ts",
      "cases": [
        "published-vectors"
      ]
    },
    {
      "ticket_id": "E2-002",
      "acceptance_id": "AC-E2-002-2",
      "test_path": "packages/scorer/test/score.test.ts",
      "cases": [
        "O-zero"
      ]
    },
    {
      "ticket_id": "E2-002",
      "acceptance_id": "AC-E2-002-3",
      "test_path": "packages/scorer/test/score.test.ts",
      "cases": [
        "P-zero"
      ]
    },
    {
      "ticket_id": "E2-002",
      "acceptance_id": "AC-E2-002-4",
      "test_path": "packages/scorer/test/score.test.ts",
      "cases": [
        "missing-denominator"
      ]
    },
    {
      "ticket_id": "E2-002",
      "acceptance_id": "AC-E2-002-5",
      "test_path": "packages/scorer/test/score.test.ts",
      "cases": [
        "F6-M20-only"
      ]
    },
    {
      "ticket_id": "E2-002",
      "acceptance_id": "AC-E2-002-6",
      "test_path": "packages/scorer/test/score.test.ts",
      "cases": [
        "raw-precision"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-1",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "one-case-per-ten-gates"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-2",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "S0"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-3",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "S1"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-4",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "S2"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-5",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "S3"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-6",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "tamper"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-7",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "adapter-gap"
      ]
    },
    {
      "ticket_id": "E2-003",
      "acceptance_id": "AC-E2-003-8",
      "test_path": "packages/scorer/test/issuance.test.ts",
      "cases": [
        "reason-order"
      ]
    },
    {
      "ticket_id": "E2-004",
      "acceptance_id": "AC-E2-004-1",
      "test_path": "packages/scorer/test/fixture-corpus.test.ts",
      "cases": [
        "fixture-census"
      ]
    },
    {
      "ticket_id": "E2-004",
      "acceptance_id": "AC-E2-004-2",
      "test_path": "packages/scorer/test/fixture-corpus.test.ts",
      "cases": [
        "each-family"
      ]
    },
    {
      "ticket_id": "E2-004",
      "acceptance_id": "AC-E2-004-3",
      "test_path": "packages/scorer/test/fixture-corpus.test.ts",
      "cases": [
        "mutation-survives"
      ]
    },
    {
      "ticket_id": "E2-004",
      "acceptance_id": "AC-E2-004-4",
      "test_path": "packages/scorer/test/fixture-corpus.test.ts",
      "cases": [
        "digest-manifest"
      ]
    },
    {
      "ticket_id": "E2-004",
      "acceptance_id": "AC-E2-004-5",
      "test_path": "packages/scorer/test/fixture-corpus.test.ts",
      "cases": [
        "no-answer-leak"
      ]
    },
    {
      "ticket_id": "E2-005",
      "acceptance_id": "AC-E2-005-1",
      "test_path": "conformance/g0/g0.test.ts",
      "cases": [
        "pass"
      ]
    },
    {
      "ticket_id": "E2-005",
      "acceptance_id": "AC-E2-005-2",
      "test_path": "conformance/g0/g0.test.ts",
      "cases": [
        "one-mutant-live"
      ]
    },
    {
      "ticket_id": "E2-005",
      "acceptance_id": "AC-E2-005-3",
      "test_path": "conformance/g0/g0.test.ts",
      "cases": [
        "byte-drift"
      ]
    },
    {
      "ticket_id": "E2-005",
      "acceptance_id": "AC-E2-005-4",
      "test_path": "conformance/g0/g0.test.ts",
      "cases": [
        "stale-digest"
      ]
    },
    {
      "ticket_id": "E2-005",
      "acceptance_id": "AC-E2-005-5",
      "test_path": "conformance/g0/g0.test.ts",
      "cases": [
        "zero-fixture"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-1",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "fresh"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-2",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "dirty-base"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-3",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "wrong-root"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-4",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "symlink-escape"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-5",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "source-mutation"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-6",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "residue"
      ]
    },
    {
      "ticket_id": "E3-001",
      "acceptance_id": "AC-E3-001-7",
      "test_path": "packages/runner/test/workspace.test.ts",
      "cases": [
        "actor-attribution-classification"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-1",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "oracle-path"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-10",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "post-run-materialization"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-2",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "env-secret"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-3",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "fd-leak"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-4",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "ipc-leak"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-5",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "child-inherit"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-6",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "redaction"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-7",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "temp-oracle"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-8",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "symlink-oracle"
      ]
    },
    {
      "ticket_id": "E3-002",
      "acceptance_id": "AC-E3-002-9",
      "test_path": "packages/runner/test/isolation.test.ts",
      "cases": [
        "proc-fd-oracle"
      ]
    },
    {
      "ticket_id": "E3-003",
      "acceptance_id": "AC-E3-003-1",
      "test_path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "concurrent-budget"
      ]
    },
    {
      "ticket_id": "E3-003",
      "acceptance_id": "AC-E3-003-2",
      "test_path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "refund"
      ]
    },
    {
      "ticket_id": "E3-003",
      "acceptance_id": "AC-E3-003-3",
      "test_path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "timeout"
      ]
    },
    {
      "ticket_id": "E3-003",
      "acceptance_id": "AC-E3-003-4",
      "test_path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "seed-replay"
      ]
    },
    {
      "ticket_id": "E3-003",
      "acceptance_id": "AC-E3-003-5",
      "test_path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "approval-deny"
      ]
    },
    {
      "ticket_id": "E3-003",
      "acceptance_id": "AC-E3-003-6",
      "test_path": "packages/runner/test/budget-fault.test.ts",
      "cases": [
        "duplicate-effect"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-1",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "all-terminal-states"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-2",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "illegal-transition"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-3",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "stall"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-4",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "timeout"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-5",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "cancel-race"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-6",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "orphan"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-7",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "final-checkpoint"
      ]
    },
    {
      "ticket_id": "E3-004",
      "acceptance_id": "AC-E3-004-8",
      "test_path": "packages/runner/test/lifecycle.test.ts",
      "cases": [
        "unknown-attribution-terminal-outcome"
      ]
    },
    {
      "ticket_id": "E4-001",
      "acceptance_id": "AC-E4-001-1",
      "test_path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "lifecycle-happy"
      ]
    },
    {
      "ticket_id": "E4-001",
      "acceptance_id": "AC-E4-001-2",
      "test_path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "start-fail"
      ]
    },
    {
      "ticket_id": "E4-001",
      "acceptance_id": "AC-E4-001-3",
      "test_path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "stop-timeout"
      ]
    },
    {
      "ticket_id": "E4-001",
      "acceptance_id": "AC-E4-001-4",
      "test_path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "double-stop"
      ]
    },
    {
      "ticket_id": "E4-001",
      "acceptance_id": "AC-E4-001-5",
      "test_path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "capability-digest"
      ]
    },
    {
      "ticket_id": "E4-001",
      "acceptance_id": "AC-E4-001-6",
      "test_path": "adapters/codex/test/interface.test.ts",
      "cases": [
        "primary-source-boundary"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-1",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "complete"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-2",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "limited"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-3",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "unknown"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-4",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "missing-required"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-5",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "config-redaction"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-6",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "stable-digest"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-7",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "installed-schema-digest"
      ]
    },
    {
      "ticket_id": "E4-002",
      "acceptance_id": "AC-E4-002-8",
      "test_path": "adapters/codex/test/capabilities.test.ts",
      "cases": [
        "forbidden-source"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-1",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "event-parity"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-2",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "secret-canary"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-3",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "oversized"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-4",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "unknown-native"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-5",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "missing-parent"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-6",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "tool-error"
      ]
    },
    {
      "ticket_id": "E4-003",
      "acceptance_id": "AC-E4-003-7",
      "test_path": "adapters/codex/test/normalize.test.ts",
      "cases": [
        "actor-attribution-events"
      ]
    },
    {
      "ticket_id": "E4-004",
      "acceptance_id": "AC-E4-004-1",
      "test_path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "complete"
      ]
    },
    {
      "ticket_id": "E4-004",
      "acceptance_id": "AC-E4-004-2",
      "test_path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "degraded"
      ]
    },
    {
      "ticket_id": "E4-004",
      "acceptance_id": "AC-E4-004-3",
      "test_path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "blocked"
      ]
    },
    {
      "ticket_id": "E4-004",
      "acceptance_id": "AC-E4-004-4",
      "test_path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "imported"
      ]
    },
    {
      "ticket_id": "E4-004",
      "acceptance_id": "AC-E4-004-5",
      "test_path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "event-missing"
      ]
    },
    {
      "ticket_id": "E4-004",
      "acceptance_id": "AC-E4-004-6",
      "test_path": "adapters/codex/test/conformance.test.ts",
      "cases": [
        "digest-change"
      ]
    },
    {
      "ticket_id": "E5-001",
      "acceptance_id": "AC-E5-001-1",
      "test_path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "valid"
      ]
    },
    {
      "ticket_id": "E5-001",
      "acceptance_id": "AC-E5-001-2",
      "test_path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "late-edit"
      ]
    },
    {
      "ticket_id": "E5-001",
      "acceptance_id": "AC-E5-001-3",
      "test_path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "oracle-visible"
      ]
    },
    {
      "ticket_id": "E5-001",
      "acceptance_id": "AC-E5-001-4",
      "test_path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "over-primary"
      ]
    },
    {
      "ticket_id": "E5-001",
      "acceptance_id": "AC-E5-001-5",
      "test_path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "duplicate-opportunity"
      ]
    },
    {
      "ticket_id": "E5-001",
      "acceptance_id": "AC-E5-001-6",
      "test_path": "packages/runner/test/scenario-registry.test.ts",
      "cases": [
        "exposure-missing"
      ]
    },
    {
      "ticket_id": "E5-002",
      "acceptance_id": "AC-E5-002-1",
      "test_path": "suites/coding-core-v0/test/fam4-continuity.test.ts",
      "cases": [
        "fresh-resume"
      ]
    },
    {
      "ticket_id": "E5-002",
      "acceptance_id": "AC-E5-002-2",
      "test_path": "suites/coding-core-v0/test/fam4-continuity.test.ts",
      "cases": [
        "stale-checkpoint"
      ]
    },
    {
      "ticket_id": "E5-002",
      "acceptance_id": "AC-E5-002-3",
      "test_path": "suites/coding-core-v0/test/fam4-continuity.test.ts",
      "cases": [
        "missing-blocker"
      ]
    },
    {
      "ticket_id": "E5-002",
      "acceptance_id": "AC-E5-002-4",
      "test_path": "suites/coding-core-v0/test/fam4-continuity.test.ts",
      "cases": [
        "wrong-evidence"
      ]
    },
    {
      "ticket_id": "E5-002",
      "acceptance_id": "AC-E5-002-5",
      "test_path": "suites/coding-core-v0/test/fam4-continuity.test.ts",
      "cases": [
        "valid-alternative"
      ]
    },
    {
      "ticket_id": "E5-003",
      "acceptance_id": "AC-E5-003-1",
      "test_path": "suites/coding-core-v0/test/fam4-idempotency.test.ts",
      "cases": [
        "single-effect"
      ]
    },
    {
      "ticket_id": "E5-003",
      "acceptance_id": "AC-E5-003-2",
      "test_path": "suites/coding-core-v0/test/fam4-idempotency.test.ts",
      "cases": [
        "duplicate-effect"
      ]
    },
    {
      "ticket_id": "E5-003",
      "acceptance_id": "AC-E5-003-3",
      "test_path": "suites/coding-core-v0/test/fam4-idempotency.test.ts",
      "cases": [
        "wrong-key"
      ]
    },
    {
      "ticket_id": "E5-003",
      "acceptance_id": "AC-E5-003-4",
      "test_path": "suites/coding-core-v0/test/fam4-idempotency.test.ts",
      "cases": [
        "illegal-transition"
      ]
    },
    {
      "ticket_id": "E5-003",
      "acceptance_id": "AC-E5-003-5",
      "test_path": "suites/coding-core-v0/test/fam4-idempotency.test.ts",
      "cases": [
        "stale-ack"
      ]
    },
    {
      "ticket_id": "E5-004",
      "acceptance_id": "AC-E5-004-1",
      "test_path": "suites/coding-core-v0/test/fam4-stall.test.ts",
      "cases": [
        "detect"
      ]
    },
    {
      "ticket_id": "E5-004",
      "acceptance_id": "AC-E5-004-2",
      "test_path": "suites/coding-core-v0/test/fam4-stall.test.ts",
      "cases": [
        "false-complete"
      ]
    },
    {
      "ticket_id": "E5-004",
      "acceptance_id": "AC-E5-004-3",
      "test_path": "suites/coding-core-v0/test/fam4-stall.test.ts",
      "cases": [
        "wrong-stop"
      ]
    },
    {
      "ticket_id": "E5-004",
      "acceptance_id": "AC-E5-004-4",
      "test_path": "suites/coding-core-v0/test/fam4-stall.test.ts",
      "cases": [
        "budget-overrun"
      ]
    },
    {
      "ticket_id": "E5-004",
      "acceptance_id": "AC-E5-004-5",
      "test_path": "suites/coding-core-v0/test/fam4-stall.test.ts",
      "cases": [
        "valid-blocked"
      ]
    },
    {
      "ticket_id": "E6-001",
      "acceptance_id": "AC-E6-001-1",
      "test_path": "suites/coding-core-v0/test/fam5-false-completion.test.ts",
      "cases": [
        "public-green-hidden-fail"
      ]
    },
    {
      "ticket_id": "E6-001",
      "acceptance_id": "AC-E6-001-2",
      "test_path": "suites/coding-core-v0/test/fam5-false-completion.test.ts",
      "cases": [
        "true-pass"
      ]
    },
    {
      "ticket_id": "E6-001",
      "acceptance_id": "AC-E6-001-3",
      "test_path": "suites/coding-core-v0/test/fam5-false-completion.test.ts",
      "cases": [
        "honest-fail"
      ]
    },
    {
      "ticket_id": "E6-001",
      "acceptance_id": "AC-E6-001-4",
      "test_path": "suites/coding-core-v0/test/fam5-false-completion.test.ts",
      "cases": [
        "oracle-access"
      ]
    },
    {
      "ticket_id": "E6-002",
      "acceptance_id": "AC-E6-002-1",
      "test_path": "suites/coding-core-v0/test/fam5-stale-evidence.test.ts",
      "cases": [
        "pre-change-stale"
      ]
    },
    {
      "ticket_id": "E6-002",
      "acceptance_id": "AC-E6-002-2",
      "test_path": "suites/coding-core-v0/test/fam5-stale-evidence.test.ts",
      "cases": [
        "exact-head-pass"
      ]
    },
    {
      "ticket_id": "E6-002",
      "acceptance_id": "AC-E6-002-3",
      "test_path": "suites/coding-core-v0/test/fam5-stale-evidence.test.ts",
      "cases": [
        "partial-rerun"
      ]
    },
    {
      "ticket_id": "E6-002",
      "acceptance_id": "AC-E6-002-4",
      "test_path": "suites/coding-core-v0/test/fam5-stale-evidence.test.ts",
      "cases": [
        "wrong-artifact"
      ]
    },
    {
      "ticket_id": "E6-002",
      "acceptance_id": "AC-E6-002-5",
      "test_path": "suites/coding-core-v0/test/fam5-stale-evidence.test.ts",
      "cases": [
        "timestamp-only"
      ]
    },
    {
      "ticket_id": "E6-003",
      "acceptance_id": "AC-E6-003-1",
      "test_path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "in-scope-pass"
      ]
    },
    {
      "ticket_id": "E6-003",
      "acceptance_id": "AC-E6-003-2",
      "test_path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "omission"
      ]
    },
    {
      "ticket_id": "E6-003",
      "acceptance_id": "AC-E6-003-3",
      "test_path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "extra-path"
      ]
    },
    {
      "ticket_id": "E6-003",
      "acceptance_id": "AC-E6-003-4",
      "test_path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "regression"
      ]
    },
    {
      "ticket_id": "E6-003",
      "acceptance_id": "AC-E6-003-5",
      "test_path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "wrong-target"
      ]
    },
    {
      "ticket_id": "E6-003",
      "acceptance_id": "AC-E6-003-6",
      "test_path": "suites/coding-core-v0/test/fam5-scope-regression.test.ts",
      "cases": [
        "broad-rewrite"
      ]
    },
    {
      "ticket_id": "E6-004",
      "acceptance_id": "AC-E6-004-1",
      "test_path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "honest-pass"
      ]
    },
    {
      "ticket_id": "E6-004",
      "acceptance_id": "AC-E6-004-2",
      "test_path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "honest-fail"
      ]
    },
    {
      "ticket_id": "E6-004",
      "acceptance_id": "AC-E6-004-3",
      "test_path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "honest-blocked"
      ]
    },
    {
      "ticket_id": "E6-004",
      "acceptance_id": "AC-E6-004-4",
      "test_path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "false-pass"
      ]
    },
    {
      "ticket_id": "E6-004",
      "acceptance_id": "AC-E6-004-5",
      "test_path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "stale-pass"
      ]
    },
    {
      "ticket_id": "E6-004",
      "acceptance_id": "AC-E6-004-6",
      "test_path": "conformance/fam5/fam5.test.ts",
      "cases": [
        "no-claim-terminal"
      ]
    },
    {
      "ticket_id": "E7-001",
      "acceptance_id": "AC-E7-001-1",
      "test_path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "timeout"
      ]
    },
    {
      "ticket_id": "E7-001",
      "acceptance_id": "AC-E7-001-2",
      "test_path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "rate-limit"
      ]
    },
    {
      "ticket_id": "E7-001",
      "acceptance_id": "AC-E7-001-3",
      "test_path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "human-decision"
      ]
    },
    {
      "ticket_id": "E7-001",
      "acceptance_id": "AC-E7-001-4",
      "test_path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "permanent-fail"
      ]
    },
    {
      "ticket_id": "E7-001",
      "acceptance_id": "AC-E7-001-5",
      "test_path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "bad-fallback"
      ]
    },
    {
      "ticket_id": "E7-001",
      "acceptance_id": "AC-E7-001-6",
      "test_path": "suites/coding-core-v0/test/fam6-recovery.test.ts",
      "cases": [
        "minimum-recovery"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-1",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "S0"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-2",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "S1"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-3",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "S2"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-4",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "S3"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-5",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "over-restrict"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-6",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "over-privilege"
      ]
    },
    {
      "ticket_id": "E7-002",
      "acceptance_id": "AC-E7-002-7",
      "test_path": "suites/coding-core-v0/test/fam6-safety.test.ts",
      "cases": [
        "wrong-target"
      ]
    },
    {
      "ticket_id": "E7-003",
      "acceptance_id": "AC-E7-003-1",
      "test_path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "pareto-best"
      ]
    },
    {
      "ticket_id": "E7-003",
      "acceptance_id": "AC-E7-003-2",
      "test_path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "cheap-fail"
      ]
    },
    {
      "ticket_id": "E7-003",
      "acceptance_id": "AC-E7-003-3",
      "test_path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "redundant-layer"
      ]
    },
    {
      "ticket_id": "E7-003",
      "acceptance_id": "AC-E7-003-4",
      "test_path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "missing-token"
      ]
    },
    {
      "ticket_id": "E7-003",
      "acceptance_id": "AC-E7-003-5",
      "test_path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "human-time"
      ]
    },
    {
      "ticket_id": "E7-003",
      "acceptance_id": "AC-E7-003-6",
      "test_path": "suites/coding-core-v0/test/fam6-efficiency.test.ts",
      "cases": [
        "unsafe-cheap"
      ]
    },
    {
      "ticket_id": "E7-004",
      "acceptance_id": "AC-E7-004-1",
      "test_path": "conformance/demos/demo.test.ts",
      "cases": [
        "each-demo"
      ]
    },
    {
      "ticket_id": "E7-004",
      "acceptance_id": "AC-E7-004-2",
      "test_path": "conformance/demos/demo.test.ts",
      "cases": [
        "no-private-data"
      ]
    },
    {
      "ticket_id": "E7-004",
      "acceptance_id": "AC-E7-004-3",
      "test_path": "conformance/demos/demo.test.ts",
      "cases": [
        "byte-stable"
      ]
    },
    {
      "ticket_id": "E7-004",
      "acceptance_id": "AC-E7-004-4",
      "test_path": "conformance/demos/demo.test.ts",
      "cases": [
        "claim-scan"
      ]
    },
    {
      "ticket_id": "E7-004",
      "acceptance_id": "AC-E7-004-5",
      "test_path": "conformance/demos/demo.test.ts",
      "cases": [
        "stale-manifest"
      ]
    },
    {
      "ticket_id": "E8-001",
      "acceptance_id": "AC-E8-001-1",
      "test_path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "goal-fidelity"
      ]
    },
    {
      "ticket_id": "E8-001",
      "acceptance_id": "AC-E8-001-2",
      "test_path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "scope"
      ]
    },
    {
      "ticket_id": "E8-001",
      "acceptance_id": "AC-E8-001-3",
      "test_path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "necessary-ask"
      ]
    },
    {
      "ticket_id": "E8-001",
      "acceptance_id": "AC-E8-001-4",
      "test_path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "unnecessary-ask"
      ]
    },
    {
      "ticket_id": "E8-001",
      "acceptance_id": "AC-E8-001-5",
      "test_path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "acceptance-map"
      ]
    },
    {
      "ticket_id": "E8-001",
      "acceptance_id": "AC-E8-001-6",
      "test_path": "suites/coding-core-v0/test/fam1-intent.test.ts",
      "cases": [
        "hidden-outcome"
      ]
    },
    {
      "ticket_id": "E8-002",
      "acceptance_id": "AC-E8-002-1",
      "test_path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "gold-recall"
      ]
    },
    {
      "ticket_id": "E8-002",
      "acceptance_id": "AC-E8-002-2",
      "test_path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "decoy-precision"
      ]
    },
    {
      "ticket_id": "E8-002",
      "acceptance_id": "AC-E8-002-3",
      "test_path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "stale"
      ]
    },
    {
      "ticket_id": "E8-002",
      "acceptance_id": "AC-E8-002-4",
      "test_path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "injection"
      ]
    },
    {
      "ticket_id": "E8-002",
      "acceptance_id": "AC-E8-002-5",
      "test_path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "no-retrieval"
      ]
    },
    {
      "ticket_id": "E8-002",
      "acceptance_id": "AC-E8-002-6",
      "test_path": "suites/coding-core-v0/test/fam2-context.test.ts",
      "cases": [
        "citation-grounding"
      ]
    },
    {
      "ticket_id": "E8-003",
      "acceptance_id": "AC-E8-003-1",
      "test_path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "atomicity"
      ]
    },
    {
      "ticket_id": "E8-003",
      "acceptance_id": "AC-E8-003-2",
      "test_path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "false-parallel"
      ]
    },
    {
      "ticket_id": "E8-003",
      "acceptance_id": "AC-E8-003-3",
      "test_path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "valid-parallel"
      ]
    },
    {
      "ticket_id": "E8-003",
      "acceptance_id": "AC-E8-003-4",
      "test_path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "direct-best"
      ]
    },
    {
      "ticket_id": "E8-003",
      "acceptance_id": "AC-E8-003-5",
      "test_path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "specialist-best"
      ]
    },
    {
      "ticket_id": "E8-003",
      "acceptance_id": "AC-E8-003-6",
      "test_path": "suites/coding-core-v0/test/fam3-graph.test.ts",
      "cases": [
        "join-integrity"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-1",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "six-family-census"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-2",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "required-core"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-3",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "eligibility"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-4",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "timing"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-5",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "exposure"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-6",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "terminal-integrity"
      ]
    },
    {
      "ticket_id": "E8-004",
      "acceptance_id": "AC-E8-004-7",
      "test_path": "conformance/form-a/form-a.test.ts",
      "cases": [
        "prescription-path"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-1",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "complete"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-2",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "limited"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-3",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "unknown"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-4",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "missing-required"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-5",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "lifecycle"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-6",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "config-redaction"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-7",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "official-source-boundary"
      ]
    },
    {
      "ticket_id": "E9-001",
      "acceptance_id": "AC-E9-001-8",
      "test_path": "adapters/claude-code/test/capabilities.test.ts",
      "cases": [
        "forbidden-internal-source"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-1",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "semantic-events"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-2",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "delegation-gap"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-3",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "secret-canary"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-4",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "oversized"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-5",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "missing-parent"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-6",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "tool-error"
      ]
    },
    {
      "ticket_id": "E9-002",
      "acceptance_id": "AC-E9-002-7",
      "test_path": "adapters/claude-code/test/normalize.test.ts",
      "cases": [
        "actor-attribution-events"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-1",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "lifecycle"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-2",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "tool-error"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-3",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "approval"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-4",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "evidence"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-5",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "intervention"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-6",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "unavailable-difference"
      ]
    },
    {
      "ticket_id": "E9-003",
      "acceptance_id": "AC-E9-003-7",
      "test_path": "conformance/adapters/parity/parity.test.ts",
      "cases": [
        "profile-difference"
      ]
    }
  ]
}
```
<!-- AOS_SEMANTIC_CATALOG_V2_END -->

## Completeness rule

The enforced static graph is `SSOT → owning ADR/PRD → PRD requirement → PRD acceptance criterion → ticket → ticket acceptance criterion → planned test path → named test case`, with one owning ADR/PRD and zero orphans. D0-004A owns static graph enforcement, accepted-record digest invalidation, issue-map/catalog agreement, computed code census, canonical identity consistency, and encoded-path-safe repository resolution.

D0-004B/C are still required for runtime execution state, external facts, protected workflow checks, and generated projections. The static catalog neither authorizes RED nor accepts a gate.
