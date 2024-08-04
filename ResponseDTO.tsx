type ActionTarget = {
    element_id: number;
    element_text: string;
}

type Action = {
    action_type: 'url' | 'input' | 'click';
    target: ActionTarget;
    value: string;
    expected_outcome: string;
}

type Plan = {
    goal_progress_assessment: string;
    current_screen_objective: string;
    proposed_actions: Action[];
    order_of_execution: number[];
    success_criteria: string;
    fallback_strategy: string;
}

export type ActionResponse = {
    reasoning: string;
    plan: Plan;
}
