Feature: Project repository knowledge relevant to an artifact
  Context is a current, provider-neutral view of the knowledge graph rather
  than a dump of the source files from which that knowledge originated.

  Scenario: Present current premise state from multiple providers
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    When I run "premise test"
    Then the command succeeds
    When I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "established"
    And context reports premise "ARCH-003" as "architecture" in "dependency-cruiser" via "dependency-cruiser" with state "established"
    And context retains source "features/PAY-001.feature" with selector "@PAY-001"
    But context does not dump the Gherkin source

  Scenario: Include a decision affected by an artifact premise
    Given an empty project
    And architecture premise "ARCH-003" protects "src/payment.ts" from "src/http-client.ts"
    And decision "AUTH-004" is driven by premise "ARCH-003"
    And decision "AUTH-004" has been reviewed
    When I run "premise test"
    Then the command succeeds
    When the architecture premise is violated
    And I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "ARCH-003" as "architecture" in "dependency-cruiser" via "dependency-cruiser" with state "failed"
    And context reports decision "AUTH-004" with state "reconsider"
    And the command explains that supporting premise "ARCH-003" failed

  Scenario: Retain artifact evidence when behaviour fails
    Given an empty project
    And executable requirement "PAY-001" exercises "src/payment.ts"
    When the payment implementation no longer satisfies the requirement
    And I run "premise context src/payment.ts"
    Then the command succeeds
    And context reports premise "PAY-001" as "behaviour" in "gherkin" via "cucumber" with state "failed"

  Scenario: Include a decision driven directly by the artifact
    Given an empty project
    And source "src/order.ts" exists
    And decision "ORDER-004" is driven by source "src/order.ts"
    And decision "ORDER-004" has been reviewed
    When I run "premise context src/order.ts"
    Then the command succeeds
    And context reports decision "ORDER-004" with state "established"
