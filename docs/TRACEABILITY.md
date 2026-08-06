# SSOT → ADR → PRD → ticket traceability

Status: **STATIC SEMANTIC CATALOG — planning authority graph for D0-004A**

D0-004A makes the static authority graph executable. The catalog below is a static planning input: it binds the SSOT, each PRD path, required ADRs, requirement count, exact PRD acceptance IDs, owned ticket IDs, explicit requirement → PRD acceptance edges, and explicit PRD acceptance → ticket edges. The validator derives every ticket’s acceptance-to-test edge from its contract, resolves each planned test path and named case against the repository test tree when that path exists, and rejects an orphan, duplicate, missing, malformed, or mismatched edge.

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
            "AC-D0-6"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-D0-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-D0-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-D0-4"
          ]
        },
        {
          "requirement_key": "5",
          "acceptance_ids": [
            "AC-D0-5"
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
            "D0-002"
          ]
        },
        {
          "acceptance_id": "AC-D0-3",
          "ticket_ids": [
            "D0-003"
          ]
        },
        {
          "acceptance_id": "AC-D0-4",
          "ticket_ids": [
            "D0-004"
          ]
        },
        {
          "acceptance_id": "AC-D0-5",
          "ticket_ids": [
            "D0-001"
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
            "AC-E0A-1"
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
            "AC-E0A-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0A-4"
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
            "AC-E0B-1"
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
            "AC-E0C-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E0C-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0C-1"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E0C-1",
          "ticket_ids": [
            "E0C-001"
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
            "AC-E0D-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E0D-1"
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
            "AC-E1-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E1-1"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E1-1",
          "ticket_ids": [
            "E1-001"
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
            "AC-E10-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E10-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E10-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E10-4"
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
            "E10-002"
          ]
        },
        {
          "acceptance_id": "AC-E10-3",
          "ticket_ids": [
            "E10-003"
          ]
        },
        {
          "acceptance_id": "AC-E10-4",
          "ticket_ids": [
            "E10-001"
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
            "AC-E11-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E11-4"
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
            "E11-001"
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
            "AC-E3-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E3-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
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
            "E3-001"
          ]
        },
        {
          "acceptance_id": "AC-E3-2",
          "ticket_ids": [
            "E3-002"
          ]
        },
        {
          "acceptance_id": "AC-E3-3",
          "ticket_ids": [
            "E3-003"
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
            "AC-E4-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E4-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E4-1",
          "ticket_ids": [
            "E4-001"
          ]
        },
        {
          "acceptance_id": "AC-E4-2",
          "ticket_ids": [
            "E4-002"
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
            "E4-001"
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
            "AC-E5-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E5-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E5-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E5-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E5-1",
          "ticket_ids": [
            "E5-001"
          ]
        },
        {
          "acceptance_id": "AC-E5-2",
          "ticket_ids": [
            "E5-002"
          ]
        },
        {
          "acceptance_id": "AC-E5-3",
          "ticket_ids": [
            "E5-003"
          ]
        },
        {
          "acceptance_id": "AC-E5-4",
          "ticket_ids": [
            "E5-004"
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
            "AC-E6-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E6-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E6-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E6-4"
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
            "E6-002"
          ]
        },
        {
          "acceptance_id": "AC-E6-3",
          "ticket_ids": [
            "E6-003"
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
            "AC-E7-1"
          ]
        },
        {
          "requirement_key": "2",
          "acceptance_ids": [
            "AC-E7-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E7-3"
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
            "E7-001"
          ]
        },
        {
          "acceptance_id": "AC-E7-2",
          "ticket_ids": [
            "E7-002"
          ]
        },
        {
          "acceptance_id": "AC-E7-3",
          "ticket_ids": [
            "E7-003"
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
            "AC-E8-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E8-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E8-4"
          ]
        }
      ],
      "acceptance_to_tickets": [
        {
          "acceptance_id": "AC-E8-1",
          "ticket_ids": [
            "E8-001"
          ]
        },
        {
          "acceptance_id": "AC-E8-2",
          "ticket_ids": [
            "E8-002"
          ]
        },
        {
          "acceptance_id": "AC-E8-3",
          "ticket_ids": [
            "E8-003"
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
            "AC-E9-2"
          ]
        },
        {
          "requirement_key": "3",
          "acceptance_ids": [
            "AC-E9-3"
          ]
        },
        {
          "requirement_key": "4",
          "acceptance_ids": [
            "AC-E9-4"
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
            "E9-002"
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
            "E9-001"
          ]
        },
        {
          "acceptance_id": "AC-E9-5",
          "ticket_ids": [
            "E9-002"
          ]
        }
      ]
    }
  ]
}
```
<!-- AOS_SEMANTIC_CATALOG_V2_END -->

## Completeness rule

The enforced static graph is `SSOT → owning ADR/PRD → PRD requirement → PRD acceptance criterion → ticket → ticket acceptance criterion → test file → named test case`, with one owning ADR/PRD and zero orphans. D0-004A owns static graph enforcement, accepted-record digest invalidation, issue-map/catalog agreement, computed code census, canonical identity consistency, and encoded-path-safe repository resolution.

D0-004B/C are still required for runtime execution state, external facts, protected workflow checks, and generated projections. The static catalog neither authorizes RED nor accepts a gate.
