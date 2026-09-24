Feature: Evaluate architecture premises through dependency-cruiser
  Architecture constraints use the same premise lifecycle as behaviour without
  leaking dependency-cruiser concepts into the Premise core.

  Scenario: Evaluate behaviour and architecture premises together
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    When I run "premise check"
    Then the command succeeds
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
    And context reports premise "ARCH-003" as "architecture" in "dependency-cruiser" via "dependency-cruiser" with state "established"

  Scenario: Report a violated architecture premise
    Given an empty project
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    And the architecture premise is violated
    When I run "premise check"
    Then the command fails
    And the command reports that premise "ARCH-003" failed
    And the command reports the forbidden dependency
