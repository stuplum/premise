Feature: Compile executable requirements into implementation context
  Gherkin remains the readable source of business behaviour.
  Premise discovers its implementation relationships from successful execution.

  Scenario: Record the requirement that exercises an implementation file
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And the command returns the current Gherkin for requirement "PAY-001"
    And no legacy Premise files are created

  Scenario: A changed requirement invalidates its discovered implementation context
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When requirement "PAY-001" has changed
    And I run "premise test"
    Then the command succeeds
    And I run "premise check"
    Then the command fails
    And the command reports that "PAY-001" changed
    And the command reports "src/payment.ts" for reconsideration

  Scenario: Acknowledge a changed requirement after reconsidering discovered implementation
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When requirement "PAY-001" has changed
    And I run "premise test"
    Then the command succeeds
    When I run "premise acknowledge PAY-001"
    Then the command succeeds
    When I run "premise check"
    Then the command succeeds
    And the command produces no output

  Scenario: Ignore code loaded by the test adapter but not exercised by the requirement
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment-audit.ts"
    Then the command succeeds
    And the command reports no compiled context for "src/payment-audit.ts"

  Scenario: Retrieve compiled context with an absolute implementation path
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When I run premise context with the absolute path to "src/payment.ts"
    Then the command succeeds
    And the command returns the current Gherkin for requirement "PAY-001"

  Scenario: Reject an absolute implementation path outside the project
    Given an empty project
    When I run premise context with an absolute path outside the project
    Then the command fails
    And the command reports that the path must be inside the project
