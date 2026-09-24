@PROV-018
Feature: Isolate provider project state
  A provider definition can be reused without one project's discovery state or
  cached analysis affecting another project.

  Scenario: Evaluate interleaved project sessions
    Given two projects define distinct architecture premises
    When I prepare both projects with the same provider before evaluating either
    Then each provider session establishes its own architecture premise
