Feature: Run executable requirements with minimal setup
  Premise runs executable Gherkin without requiring manual relationship files.
  Configuration is optional and only changes how executable requirements are found.

  Scenario: Run executable requirements without Premise configuration
    Given an empty project
    And a passing executable requirement in the default feature directory
    When I run "premise test"
    Then the command succeeds
    And the executable requirement ran
    And the command warns that "features/example.feature" has no requirement ID
    And no legacy Premise files are created

  Scenario: Fail when an executable requirement is not satisfied
    Given an empty project
    And a failing executable requirement in the default feature directory
    When I run "premise test"
    Then the command fails
    And the command reports that the executable requirement failed

  Scenario: Run executable requirements from configured paths
    Given an empty project
    And Premise is configured to find features in "specifications" and steps in "specifications/support"
    And a passing executable requirement exists in the configured directories
    When I run "premise test"
    Then the command succeeds
    And the executable requirement ran

  Scenario Outline: Reject a removed manual workflow command
    Given an empty project
    When I run "<command>"
    Then the command fails
    And the command reports only the supported commands

    Examples:
      | command                                        |
      | premise init                                     |
      | premise add PAY-001 --source requirement.feature |
      | premise acknowledge PAY-001                     |

  Scenario: Reject legacy manual relationship configuration
    Given a project with legacy manual relationship configuration
    And a passing executable requirement in the default feature directory
    When I run "premise test"
    Then the command fails
    And the command reports invalid Premise configuration
