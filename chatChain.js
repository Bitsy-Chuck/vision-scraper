import {ChatOpenAI} from "@langchain/openai";
import {RunnableSequence, RunnableWithMessageHistory} from "@langchain/core/runnables";
import {ChatPromptTemplate} from "@langchain/core/prompts";
import {InMemoryChatMessageHistory} from "@langchain/core/chat_history";

import {logger} from "./utils.js";

// import { logger } from './utils.js';

const system_prompt = `You are a sophisticated website crawler with advanced analytical capabilities. You will be given instructions on what to do by browsing.
 You are connected to a web browser and will be provided with either a screenshot of the website you are on or a detailed textual context of the current state.
  The interactable elements on the website are highlighted with a red outline and light red background.
   Always base your understanding on the provided information. Don't make assumptions about elements or content not explicitly mentioned.

When provided with an image, analyze it thoroughly. For subsequent interactions, you will receive a detailed textual context instead of an image.

You will receive context in the following elaborate format:

{{
  "current_screen_analysis": {{
    "page_title": "",
    "url": "",
    "main_content_summary": "",
    "visible_sections": [],
    "error_messages": [],
    "success_messages": [],
    "interactable_elements": []
  }},
  "previous_actions": [],
  "current_screen_goal": {{
    "primary_objective": "",
    "success_criteria": []
  }},
  "main_goal": {{
    "overall_objective": "",
    "success_criteria": []
  }},
  "available_actions": [],
  "user_input": {{
    "latest_command": ""
  }},
  "session_metadata": {{
    "start_time": "",
    "current_time": "",
    "pages_visited": [],
    "total_actions_performed": 0
  }},
  "environmental_factors": {{
    "detected_language": "",
    "user_agent": "",
    "screen_resolution": "",
    "connection_speed": ""
  }}
}}

Your task is to:
1. Thoroughly analyze the current state using the detailed information provided.
2. Understand the main goal and how it relates to the current screen's objective.
3. Evaluate the progress made towards the main goal and identify any blockers.
4. Determine the most appropriate action(s) to take next, considering:
   a. The current screen's goal
   b. Available actions
   c. Previous actions and their results
   d. Any user input or commands
   e. Environmental factors that might influence decision-making
5. If applicable, process any user input and incorporate it into your decision-making.
6. Provide a clear and concise plan of action.

## Available Interactables
{element_map}

You can interact with the website by providing a JSON object with the following schema:

{{
  "reasoning": "Explain your thought process and decision-making here",
  "plan": {{
    "goal_progress_assessment": "Briefly assess the progress towards the main goal",
    "current_screen_objective": "State the objective for the current screen",
    "proposed_actions": [
      {{
        "action_type": "url" | "input" | "click",
        "target": {{
          "element_id": number,
          "element_text": "text inside element"
        }},
        "value": string,
        "expected_outcome": string
      }}
    ],
    "order_of_execution": [0, 1, 2...],
    "success_criteria": "Define what successful execution of this plan looks like",
    "fallback_strategy": "Describe what to do if the plan fails"
  }}
}}

ONLY provide the JSON object with the schema above. Do not include any other information in your response.
NO TYPE DEFINITION IS REQUIRED. JUST PROVIDE THE JSON OBJECT.

Good example:
{{
json object...
}}

Bad example:
\`\`\`json
{{
json...
}}
\`\`\`

The output will be parsed without any modifications. Ensure that your response is in the correct format to avoid errors in evaluation.


Action types and their usage:
- URL navigation: {{"action_type": "url", "value": "https://example.com"}}
- Text input: {{"action_type": "input", "target": {{"element_id": 1, "element_text": "Username field"}}, "value": "user123"}}
- Clicking elements: {{"action_type": "click", "target": {{"element_id": 2, "element_text": "Submit button"}}}}


Important rules:
1. Always provide a clear reasoning for your decisions.
2. Ensure that input actions are followed by appropriate submission actions.
3. Use the provided element information; do not assume the existence of elements not mentioned in the context.
4. Consider environmental factors when making decisions (e.g., adjust for detected language or connection speed).
5. If encountering errors or unexpected situations, provide a detailed analysis and suggest troubleshooting steps.
6. When the main goal is achieved or if you need more information from the user, respond with a regular message explaining the situation and asking for further instructions if necessary.
7. DO NOT ASSUME INPUT UNLESS SPECIFICALLY MENTIONED IN THE CONTEXT. ALWAYS BASE YOUR DECISIONS ON THE PROVIDED INFORMATION.


Remember, your role is to navigate web interfaces intelligently, always working towards the main goal while adapting to the current context and user input. Provide clear, concise, and well-reasoned actions to progress through the task efficiently.

THIS IS THE STATIC CONTEXT. consider this your knowledge base
{static_history}

=== IGNORE THIS LINE. AFTER THIS YOU WILL RECIEVE THE INPUTS ===
CONTEXT: {context}
`;

/*
- Waiting: {{"action_type": "wait", "value": "5000"}} (wait for 5000 milliseconds)
- Scrolling: {{"action_type": "scroll", "value": "down" | "up" | "bottom" | "top"}}

| "wait" | "scroll",
 */
const printIntermediateStage = (input) => {
    logger.info(`Intermediate stage - Input to the model: ${JSON.stringify(input, null, 2)}`);
    return JSON.stringify(input);
};

function cleanMessageHistory(messageHistory) {
    return messageHistory.map(message => {
        if (message.content && typeof message.content === 'object' && message.content.content) {
            // Remove image data from previous messages
            message.content.content = message.content.content.filter(item => item.type !== 'image_url');
        }
        return message;
    });
}

export async function setupChatChain(messageHistories) {
    const promptTemplate = ChatPromptTemplate.fromMessages([
        ["system", system_prompt],
        ["placeholder", "{chat_history}"],
        ["human", "{input}"],
    ]);

    const model = new ChatOpenAI({
        model: "gpt-4o",
        temperature: 0.7,
        max_tokens: 1000,
    });

    // const parser = new JsonOutputParser<ActionResponse>();

    const chain = RunnableSequence.from([
        promptTemplate,
        printIntermediateStage,
        model,
        // parser
    ]);

    const val = `
    Generate an appropriate input value for the form field '{fieldName}'. 

    Context: {context}
    Static context: {static_history}
    
    Instructions:
    1. Consider the field name, context, and any relevant information from the static context.
    2. Generate a single, appropriate value for the field.
    3. The value should be ready to use as direct input in a form field.
    4. Do not include any explanations, quotation marks, or additional formatting.
    5. If the field requires a specific format (e.g., date, phone number), ensure the output adheres to that format.
    
    Output Format:
    {{
    "element_id" : "sample_element_id",
    "element_text" : "sample_element_text",
    "value" : "sample_value"
    }}
    
    return only in json format. 
    
    Replace [VALUE] with the actual input value, without brackets.
    
    Example outputs:
    john.doe@example.com
    1234567890
    2024-08-15
    Software Engineer
    `;
    const inputValueChain = RunnableSequence.from([
        ChatPromptTemplate.fromMessages([
            ["human", val],
        ]),
        printIntermediateStage,
        model,
    ]);


    const withMessageHistory = new RunnableWithMessageHistory({
        runnable: chain,
        getMessageHistory: async (sessionId) => {
            if (!messageHistories[sessionId]) {
                messageHistories[sessionId] = new InMemoryChatMessageHistory();
            }
            let history = messageHistories[sessionId];
            history.messages = cleanMessageHistory(history.messages);
            return history;
        },
        inputMessagesKey: "input",
        historyMessagesKey: "chat_history",
    });

    return {withMessageHistory, inputValueChain};
}

export async function generateInputValue(inputValueChain, fieldName, context) {
    try {
        const result = await inputValueChain.invoke({
            fieldName: fieldName,
            context: context,
        });
        return result.content;
    } catch (error) {
        logger.error('Error generating input value:', error);
        throw error;
    }
}
