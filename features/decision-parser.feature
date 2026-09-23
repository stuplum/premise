Feature: Parse architecture decisions
  Premise decisions describe intended architecture without depending on an
  implementation language or framework.

  Scenario: Parse a decision with drivers, accepted costs, and history
    Given the decision source:
      """
      Decision PAY-003 "Reliable confirmation delivery"

      Driven by requirement ORDER-006
      Driven by decision OPS-002

      Choose durable storage of pending confirmations

      Because accepted orders must survive delivery outages

      Accept possible duplicate delivery
      Accept additional operational storage

      Supersedes PAY-001
      """
    When the decision is parsed
    Then the parsed decision is:
      | id         | PAY-003                                           |
      | title      | Reliable confirmation delivery                    |
      | choice     | durable storage of pending confirmations          |
      | rationale  | accepted orders must survive delivery outages     |
      | supersedes | PAY-001                                           |
    And the decision starts at line 1 column 1
    And the choice starts at line 6 column 1
    And its drivers are:
      | kind        | id        |
      | requirement | ORDER-006 |
      | decision    | OPS-002   |
    And its accepted costs are:
      | possible duplicate delivery     |
      | additional operational storage  |

  Scenario: Parse a decision without optional costs or history
    Given the decision source:
      """
      Decision DATA-004 "Keep customer records regionally isolated"
      Driven by requirement DATA-009
      Choose one data store per legal region
      Because customer records must remain within their legal region
      """
    When the decision is parsed
    Then the decision has no accepted costs
    And the decision does not supersede another decision

  Scenario Outline: Reject a decision that does not follow the grammar
    Given the decision source:
      """
      <source>
      """
    When the decision is parsed
    Then parsing fails with "<message>"

    Examples:
      | source                                                                                                       | message                                      |
      | Driven by requirement ORDER-006\nChoose durable storage\nBecause delivery must survive outages                            | Expected Decision at line 1, found Driven by |
      | Decision PAY-003 "Reliable delivery"\nChoose durable storage\nBecause delivery must survive outages                            | Expected Driven by at line 2, found Choose    |
      | Decision PAY-003 "Reliable delivery"\nDriven by requirement ORDER-006\nBecause delivery must survive outages             | Expected Choose at line 3, found Because      |
      | Decision PAY-003 "Reliable delivery"\nDriven by requirement ORDER-006\nChoose durable storage                            | Expected Because at end of document           |

  Scenario: Reject statements in the wrong order
    Given the decision source:
      """
      Decision PAY-003 "Reliable confirmation delivery"
      Driven by requirement ORDER-006
      Because accepted orders must survive delivery outages
      Choose durable storage of pending confirmations
      """
    When the decision is parsed
    Then parsing fails with "Expected Choose at line 3, found Because"

  Scenario: Reject a statement with no defined meaning
    Given the decision source:
      """
      Decision PAY-003 "Reliable confirmation delivery"
      Driven by requirement ORDER-006
      Choose durable storage of pending confirmations
      Because accepted orders must survive delivery outages
      Notes This should probably use a database
      """
    When the decision is parsed
    Then parsing fails with "Unknown statement at line 5, column 1"

  Scenario: Reject a decision that supersedes itself
    Given the decision source:
      """
      Decision PAY-003 "Reliable confirmation delivery"
      Driven by requirement ORDER-006
      Choose durable storage of pending confirmations
      Because accepted orders must survive delivery outages
      Supersedes PAY-003
      """
    When the decision is parsed
    Then parsing fails with "Decision PAY-003 cannot supersede itself"
