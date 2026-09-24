Feature: Keep live provider evidence reliable
  Provider evidence must be trustworthy enough to guide implementation work.

  Scenario: Warn when execution uses a cache-busted module identity
    Given an empty project
    And an executable requirement dynamically imports "src/payment.ts" with a query
    When I run "premise test"
    Then the command succeeds
    And the command warns that dynamic module coverage may be unreliable

  Scenario: Reject duplicate requirement IDs across feature files
    Given an empty project
    And requirement ID "PAY-001" appears in two executable feature files
    When I run "premise test"
    Then the command fails
    And the command reports duplicate requirement ID "PAY-001"

  Scenario: Reject multiple requirement IDs in one feature file
    Given an empty project
    And one executable feature contains requirement IDs "PAY-001" and "PAY-002"
    When I run "premise test"
    Then the command fails
    And the command reports that "features/payments.feature" must contain one requirement ID

  Scenario: Ignore an application module that is imported but not exercised
    Given an empty project
    And an executable requirement imports "src/payment.ts" without exercising it
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And the command reports no context for "src/payment.ts"

  Scenario: Ignore requirement-like text outside Gherkin tags
    Given an empty project
    And an executable requirement contains requirement-like comments and data
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"

  Scenario: Ignore the consumer's parallel profile during coverage discovery
    Given an empty project
    And an executable requirement with a parallel Cucumber profile
    When I run "premise test"
    Then the command succeeds
    And Premise uses one worker for both coverage runs
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
