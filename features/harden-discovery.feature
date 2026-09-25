Feature: Fail clearly when executable requirement discovery is unreliable
  Premise must either compile trustworthy context or explain why it cannot.

  Scenario: Use the repository's base TypeScript configuration
    Given an empty project
    And an executable requirement uses aliases from "tsconfig.base.json"
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"

  Scenario: Isolate a nested Premise run from its parent's TypeScript configuration
    Given an empty project
    And a parent Premise process selected TypeScript configuration "parent-tsconfig.json"
    And an executable requirement uses aliases from "tsconfig.base.json"
    When I run "premise test"
    Then the command succeeds

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
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"

  Scenario: Report a step definition import failure
    Given an empty project
    And an executable requirement imports a missing implementation
    When I run "premise test"
    Then the command fails
    And the command reports the missing implementation import

  Scenario: Locate the Gherkin declaration rather than an inherited scenario
    Given an empty project
    And the discovery feature contains:
      """
      @PAY-001
      Feature: Take payments
        Rule: Accepted methods
          Scenario Outline: Accept <method>
            Then paid with <method>
            Examples: Methods
              | method |
              | card   |
              | cash   |
      """
    When I discover the behavioural premises
    Then discovery finds premise "PAY-001" described as "Take payments" at line 2 column 1

  Scenario: Discover a premise declared on an Examples block
    Given an empty project
    And the discovery feature contains:
      """
      Feature: Take payments
        Scenario Outline: Accept <method>
          Then paid with <method>
          @PAY-001
          Examples: Supported methods
            | method |
            | card   |
            | cash   |
      """
    When I discover the behavioural premises
    Then discovery finds premise "PAY-001" described as "Supported methods" at line 5 column 5

  Scenario: Reject repeated declarations rather than merge them
    Given an empty project
    And the discovery feature contains:
      """
      Feature: Take payments
        @PAY-001
        Scenario: Pay
          Then paid
        @PAY-001
        Scenario: Retry
          Then paid
      """
    When I discover the behavioural premises
    Then discovery rejects "PAY-001" at line 5 column 3

  Scenario: Reject a tagged Examples block without executable rows
    Given an empty project
    And the discovery feature contains:
      """
      Feature: Take payments
        Scenario Outline: Accept <method>
          Then paid with <method>
          @PAY-001
          Examples: No methods
            | method |
      """
    When I discover the behavioural premises
    Then discovery rejects "PAY-001" at line 4 column 5
