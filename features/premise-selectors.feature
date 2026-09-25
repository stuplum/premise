Feature: Evaluate independently selected behavioural premises
  A premise's outcome and evidence belong to its selected scenarios, not its entire file.

  Scenario: Attribute a shared scenario to both explicit premises
    Given an empty project
    And one executable feature contains requirement IDs "PAY-001" and "PAY-002"
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
    And context reports premise "PAY-002" as "behaviour" in "gherkin" via "cucumber" with state "established"

  Scenario: Keep evidence separate for scenarios in the same feature
    Given an empty project
    And two scenario premises exercise separate artifacts in one feature
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
    And context excludes premise "PAY-002"
    When I run "premise context src/cancellation.ts"
    Then the command succeeds
    And context reports premise "PAY-002" as "behaviour" in "gherkin" via "cucumber" with state "established"
    And context excludes premise "PAY-001"
