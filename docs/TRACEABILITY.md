# SSOT → ADR → PRD → ticket traceability

Status: **STATIC SEMANTIC CATALOG — planning authority graph for D0-004A**

D0-004A makes the static authority graph executable. The catalog below is a static planning input: it binds the SSOT, each PRD path, required ADRs, requirement count, exact PRD acceptance IDs, owned ticket IDs, explicit requirement → PRD acceptance edges authored from PRD requirement and AC text, explicit PRD acceptance → ticket edges authored from ticket goals and ownership, and an independent planned-test structure keyed by planned test path with exact named cases. Every ticket acceptance edge must resolve to that planned-test structure. When the planned path exists in the repository, the file must contain the exact named case; future missing files may be planned only through this static structure.

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
            "AC-E0A-2"
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
            "AC-E10-1"
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
            "AC-E12-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
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
            "AC-E13-1"
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
            "AC-E14-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E14-3"
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
            "E14-002"
          ]
        },
        {
          "acceptance_id": "AC-E14-3",
          "ticket_ids": [
            "E14-003"
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
            "AC-E2-1"
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
            "E2-002"
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
            "E2-004"
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
            "E3-001"
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
            "AC-E4-3",
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
            "AC-E5-1"
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
  ]
}
```
<!-- AOS_SEMANTIC_CATALOG_V2_END -->

## Completeness rule

The enforced static graph is `SSOT → owning ADR/PRD → PRD requirement → PRD acceptance criterion → ticket → ticket acceptance criterion → planned test path → named test case`, with one owning ADR/PRD and zero orphans. D0-004A owns static graph enforcement, accepted-record digest invalidation, issue-map/catalog agreement, computed code census, canonical identity consistency, and encoded-path-safe repository resolution.

D0-004B/C are still required for runtime execution state, external facts, protected workflow checks, and generated projections. The static catalog neither authorizes RED nor accepts a gate.
