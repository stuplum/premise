Feature: Discover executable requirements relevant to implementation
  Gherkin remains the readable source of business behaviour.
  Premise discovers its implementation relationships from successful execution.

  Scenario: Project the requirement that exercises an implementation file
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
    When I run "premise test"
    Then the command succeeds
    And no generated context files are created
    And no legacy Premise files are created

  Scenario: Establish a changed requirement through provider evaluation
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When requirement "PAY-001" has changed
    And I run "premise check"
    Then the command succeeds

  Scenario: Reject a changed requirement that is no longer satisfied
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When requirement "PAY-001" has changed
    And the payment implementation no longer satisfies the requirement
    And I run "premise check"
    Then the command fails
    And the command reports that premise "PAY-001" failed

  Scenario: Report a premise that the provider cannot evaluate
    Given an empty project
    And an executable requirement exists without step definitions
    When I run "premise check"
    Then the command fails
    And the command reports that premise "PAY-001" is unknown
    And the command reports that no step definitions matched

  Scenario: Ignore code loaded by the test adapter but not exercised by the requirement
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment-audit.ts"
    Then the command succeeds
    And the command reports no context for "src/payment-audit.ts"

  Scenario: Retrieve live context with an absolute implementation path
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise test"
    Then the command succeeds
    When I run premise context with the absolute path to "src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"

  Scenario: Reject an absolute implementation path outside the project
    Given an empty project
    When I run premise context with an absolute path outside the project
    Then the command fails
    And the command reports that the path must be inside the project
