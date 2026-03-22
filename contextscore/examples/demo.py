#!/usr/bin/env python3
"""
ContextScore Example — demonstrates scoring a real-world context window.
"""

import json
from contextscore import ContextScorer

# ── Simulate a realistic context window ──
CONTEXT = """[SYSTEM]
You are a helpful AI assistant specializing in cloud infrastructure.
You must always provide accurate information. Never make up facts.
Your role is to answer questions based on the provided context.

[RETRIEVED DOCUMENTS]
AWS EC2 instances can be launched in multiple availability zones for high availability.
The Auto Scaling service automatically adjusts capacity based on demand patterns.
EC2 instances come in various families: compute-optimized (C), memory-optimized (R),
storage-optimized (I), and general purpose (M and T families).

As mentioned above in Section 3, the pricing model varies by region and instance type.
See Table 5 for the complete breakdown of on-demand vs reserved pricing.

The weather in Seattle was particularly rainy last Tuesday, with temperatures
dropping to 45 degrees Fahrenheit by evening.

AWS Lambda functions execute code without provisioning servers. Lambda automatically
scales from a few requests per day to thousands per second. You pay only for the
compute time you consume — there is no charge when your code is not running.

AWS EC2 instances can be launched in multiple availability zones for high availability.
The Auto Scaling service automatically adjusts capacity based on demand patterns.

It is important to note that in this particular context, we should be aware of the
fact that there are many things that we need to consider and think about carefully
before making any decisions about what to do next in this situation regarding our
cloud infrastructure choices going forward at this point in time.

As of 2019, the recommended instance type for machine learning workloads was the
P3 family with NVIDIA V100 GPUs. The system is not optimized for the latest
workloads. However, the current system is optimized for modern inference tasks.
"""

QUERY = "What AWS compute services should I use for auto-scaling web applications?"


def main():
    scorer = ContextScorer(cost_per_million_tokens=5.0)
    result = scorer.score(context=CONTEXT, query=QUERY)

    # ── Print results ──
    print("=" * 70)
    print(f"  CONTEXT COHERENCE SCORE: {result.score}/100  (Grade: {result.grade})")
    print("=" * 70)
    print(f"\n{result.summary}\n")

    print("─" * 70)
    print("  DIMENSION SCORES")
    print("─" * 70)
    for name, dim in result.dimensions.items():
        bar = "█" * int(dim.score / 5) + "░" * (20 - int(dim.score / 5))
        print(f"  {name:<22} {bar} {dim.score:5.1f}  ({len(dim.issues)} issues)")

    print(f"\n{'─' * 70}")
    print("  TOKEN ECONOMICS")
    print("─" * 70)
    econ = result.economics
    print(f"  Total tokens:     {econ.total_tokens:>8,}")
    print(f"  Useful tokens:    {econ.estimated_useful_tokens:>8,}")
    print(f"  Wasted tokens:    {econ.wasted_tokens:>8,}  ({econ.waste_percentage:.1f}%)")
    print(f"  Estimated cost:   ${econ.estimated_cost:>8.4f}")
    print(f"  Wasted cost:      ${econ.wasted_cost:>8.4f}")
    print(f"  Potential savings: ${econ.potential_savings:>8.4f}")

    print(f"\n{'─' * 70}")
    print("  DIAGNOSED ISSUES (sorted by severity)")
    print("─" * 70)
    for i, issue in enumerate(result.issues, 1):
        severity_icon = {
            "critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"
        }
        icon = severity_icon.get(issue.severity.value, "⚪")
        print(f"\n  {icon} Issue #{i}: {issue.cause.value}")
        print(f"     Severity: {issue.severity.value.upper()}")
        print(f"     Category: {issue.category}")
        print(f"     Problem:  {issue.description}")
        print(f"     Fix:      {issue.fix}")
        if issue.estimated_token_savings > 0:
            print(f"     Savings:  ~{issue.estimated_token_savings} tokens ({issue.estimated_improvement:.0f} pt improvement)")

    # ── JSON output ──
    print(f"\n{'─' * 70}")
    print("  JSON OUTPUT (for API integration)")
    print("─" * 70)
    print(json.dumps(result.to_dict(), indent=2))


if __name__ == "__main__":
    main()
