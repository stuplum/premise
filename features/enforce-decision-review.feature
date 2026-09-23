Feature: Enforce review of architecture decisions
  Premise prevents a decision from silently becoming stale when one of its
  declared drivers changes, without requiring Gherkin as the driver format.

  Scenario: Accept a reviewed decision driven by Gherkin
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-001" is driven by requirement "ORDER-006"
    When I run "premise review ORDER-001"
    Then the command succeeds
    And a review receipt exists for decision "ORDER-001"
    When I run "premise check"
    Then the command succeeds

  Scenario: Reject a stale review after its Gherkin driver changes
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-001" is driven by requirement "ORDER-006"
    And decision "ORDER-001" has been reviewed
    When requirement "ORDER-006" has changed
    And I run "premise check"
    Then the command fails
    And the command reports decision "ORDER-001" for reconsideration
    And the command explains how to resolve decision "ORDER-001"
    And the command returns the current Gherkin for requirement "ORDER-006"
    And the command returns the current source for decision "ORDER-001"

  Scenario: Retain a decision after reviewing its changed driver
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-001" is driven by requirement "ORDER-006"
    And decision "ORDER-001" has been reviewed
    And requirement "ORDER-006" has changed
    When I run "premise review ORDER-001"
    Then the command succeeds
    When I run "premise check"
    Then the command succeeds

  Scenario: Replace a stale decision with a reviewed superseding decision
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-001" is driven by requirement "ORDER-006"
    And decision "ORDER-001" has been reviewed
    And requirement "ORDER-006" has changed
    And decision "ORDER-002" supersedes "ORDER-001" for requirement "ORDER-006"
    When I run "premise review ORDER-002"
    Then the command succeeds
    When I run "premise check"
    Then the command succeeds

  Scenario: Enforce a decision driven by an ordinary source file
    Given an empty project
    And source "requirements/ORDER-006.md" exists
    And decision "ORDER-001" is driven by source "requirements/ORDER-006.md"
    And decision "ORDER-001" has been reviewed
    When source "requirements/ORDER-006.md" has changed
    And I run "premise check"
    Then the command fails
    And the command reports decision "ORDER-001" for reconsideration
    And the command returns source "requirements/ORDER-006.md"

  Scenario: Ignore changes to sources that do not drive a decision
    Given an empty project
    And source "requirements/ORDER-006.md" exists
    And source "requirements/ORDER-007.md" exists
    And decision "ORDER-001" is driven by source "requirements/ORDER-006.md"
    And decision "ORDER-001" has been reviewed
    When source "requirements/ORDER-007.md" has changed
    And I run "premise check"
    Then the command succeeds

  Scenario: Reject an unreviewed active decision
    Given an empty project
    And source "requirements/ORDER-006.md" exists
    And decision "ORDER-001" is driven by source "requirements/ORDER-006.md"
    When I run "premise check"
    Then the command fails
    And the command reports decision "ORDER-001" for reconsideration

  Scenario: Reject a decision that supersedes an unknown decision
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "ORDER-002" supersedes "ORDER-001" for requirement "ORDER-006"
    When I run "premise check"
    Then the command fails
    And the command reports unknown superseded decision "ORDER-001"
