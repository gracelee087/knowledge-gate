# Agent Harness

My working definition: the harness is everything around the model that turns it into an agent.
The harness owns the loop, the tools, and what goes into the context on each turn.
The model is replaceable, but the harness is where most of the engineering effort goes.

## Open questions
- Where should state live when a run crashes halfway?
- How much of the harness should be generic, and how much should be written per task?
