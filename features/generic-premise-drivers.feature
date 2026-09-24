Feature: Drive decisions with generic premises
  Decisions refer to stable premise identities without knowing which provider
  or dialect establishes them.

  Scenario: Review a decision driven by an architecture premise
    Given an empty project
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    And decision "AUTH-002" is driven by premise "ARCH-003"
    When I run "premise review AUTH-002"
    Then the command succeeds
    And the review receipt for decision "AUTH-002" records premise "ARCH-003"
    When I run "premise check"
    Then the command succeeds
    When architecture premise "ARCH-003" changes
    And I run "premise check"
    Then the command fails
    And the command reports decision "AUTH-002" for reconsideration
    And the command returns architecture premise "ARCH-003"

  Scenario: Treat requirement as compatibility syntax for premise
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-001" is driven by requirement "ORDER-006"
    When I run "premise review ORDER-001"
    Then the command succeeds
    And the review receipt for decision "ORDER-001" records premise "ORDER-006"
    When I run "premise check"
    Then the command succeeds

  Scenario: Reject an unknown premise driver
    Given an empty project
    And decision "AUTH-002" is driven by premise "AUTH-001"
    When I run "premise check"
    Then the command fails
    And the command reports that decision "AUTH-002" references unknown premise "AUTH-001"
