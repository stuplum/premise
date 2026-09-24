Feature: Reconsider decisions driven by changed requirements
  Premise uses live repository changes and explicit knowledge relationships rather
  than fingerprints to bring architectural decisions back into context.

  Scenario: Surface the raw requirement and decision when a driver changes
    Given an empty project
    And requirement "ORDER-006" exists
    And decision "PAY-003" is driven by requirement "ORDER-006"
    And decision "PAY-003" has been reviewed
    When requirement "ORDER-006" has changed
    And I run "premise check"
    Then the command fails
    And the command reports decision "PAY-003" for reconsideration
    And the command returns the current Gherkin for requirement "ORDER-006"
    And the command returns the current source for decision "PAY-003"

  Scenario: Do not surface a decision when an unrelated requirement changes
    Given an empty project
    And requirement "ORDER-006" exists
    And requirement "ORDER-007" exists
    And decision "PAY-003" is driven by requirement "ORDER-006"
    And decision "PAY-003" has been reviewed
    When requirement "ORDER-007" has changed
    And I run "premise check"
    Then the command succeeds
    And the command produces no output

  Scenario: Reject a decision whose compatibility requirement cannot be resolved
    Given an empty project
    And decision "PAY-003" is driven by requirement "ORDER-006"
    When I run "premise check"
    Then the command fails
    And the command reports that decision "PAY-003" references unknown premise "ORDER-006"
