Feature: Derive knowledge state through decision dependencies
  Provider evaluation describes mechanical assertions while Premise derives
  reconsideration for knowledge that depends on an unestablished assertion.

  Scenario: Reconsider a decision when its premise fails
    Given an empty project
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    And decision "AUTH-002" is driven by premise "ARCH-003"
    And decision "AUTH-002" has been reviewed
    When the architecture premise is violated
    And I run "premise check"
    Then the command fails
    And the command reports that premise "ARCH-003" failed
    And the command reports decision "AUTH-002" for reconsideration
    And the command explains that supporting premise "ARCH-003" failed
    But the command does not report decision "AUTH-002" as failed

  Scenario: Propagate reconsideration through dependent decisions
    Given an empty project
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    And decision "AUTH-002" is driven by premise "ARCH-003"
    And decision "AUTH-004" is driven by decision "AUTH-002"
    And decision "AUTH-002" has been reviewed
    And decision "AUTH-004" has been reviewed
    When the architecture premise is violated
    And I run "premise check"
    Then the command fails
    And the command reports decision "AUTH-002" for reconsideration
    And the command reports decision "AUTH-004" for reconsideration
    And the command explains that supporting decision "AUTH-002" requires reconsideration

  Scenario: Reconsider a decision when its premise is unknown
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-001" is driven by premise "ORDER-006"
    And decision "ORDER-001" has been reviewed
    When the requirement step definitions are removed
    And I run "premise check"
    Then the command fails
    And the command reports that premise "ORDER-006" is unknown
    And the command reports decision "ORDER-001" for reconsideration
    And the command explains that supporting premise "ORDER-006" is unknown
