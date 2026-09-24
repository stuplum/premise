@CTX-008
Feature: Expose structured context for repository artifacts
  Library consumers can project the premises and decisions relevant to an
  artifact without depending on the CLI's text representation.

  Scenario: Project a directly related decision
    Given an empty project
    When I project context for "src/order.ts" through the Premise API
    Then the projection identifies decision "ORDER-004" as relevant

  Scenario: Keep artifact context in memory
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
    And no generated context files are created
    When I run "premise test"
    Then the command succeeds
    And no generated context files are created
