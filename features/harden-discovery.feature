Feature: Fail clearly when executable requirement discovery is unreliable
  Premise must either compile trustworthy context or explain why it cannot.

  Scenario: Use the repository's base TypeScript configuration
    Given an empty project
    And an executable requirement uses aliases from "tsconfig.base.json"
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And the command returns the current Gherkin for requirement "PAY-001"

  Scenario: Reject a test run when no executable requirements match
    Given an empty project
    When I run "premise test"
    Then the command fails
    And the command reports that no executable requirements matched

  Scenario: Reject a test run when no step definitions match
    Given an empty project
    And an executable requirement exists without step definitions
    When I run "premise test"
    Then the command fails
    And the command reports that no step definitions matched

  Scenario: Resolve an extensionless TypeScript import with an encoded TSX identity
    Given an empty project
    And executable requirement "PAY-001" exercises "apps/public/src/utils/payment.ts" through an extensionless import
    When I run "premise test"
    Then the command succeeds
    When I run "premise context apps/public/src/utils/payment.ts"
    Then the command succeeds
    And the command returns the current Gherkin for requirement "PAY-001"

  Scenario: Report a step definition import failure
    Given an empty project
    And an executable requirement imports a missing implementation
    When I run "premise test"
    Then the command fails
    And the command reports the missing implementation import
