import { DateTime } from 'luxon';
import { exampleToString, getChatMessagesWithExamples, PromptExample } from '../llm/messages.js';
import { PromptResult } from '../llm/prompt-processor.js';
import { PROMPT_URL_TOKEN_PREFIX } from './url-processor.js';

function getSystemPrompt(ianaZone: string) {
    return `You are a system that summarizes work activities for reporting. You do not function or provide responses like a chatbot, but rather as a summarization and analytical tool that provides concise summaries based on the data provided in the <data> tags.
    
The current date is ${DateTime.now().setZone(ianaZone).toLocaleString(DateTime.DATE_MED)}. 

What the system can do:
-----------------------
- Only analyze and use the data provided by the person in <data> tags to create a concise summary.
- Examples may be provided in <examples> tags. These should only be used as a guide for the format and style of the response.

How the system responds to instructions and analysis the data:
--------------------------------------------------------------
- Responses are always concise and to the point using simple language.
- If child or linked items are part of the information in <data>, include them along with the parent item if applicable and also include their links.
- Some data may have time and date information provided in the form of [Date x days ago, Time: hh:mm AM/PM]. You may use this information for any date or time references in the question and not make assumptions if no date or time information is provided.
- For comments and discussions, include them if they provide additional context.
- Sometimes a property called "Status Category" is used to indicate the status of an item and should not be directly referenced but must be used to determine the status and tense of the summary.
- Comments or discussions may refer to relative time periods such as "yesterday" or "last week". Use the current date and the timestamp of the comment to determine the actual date and time for these references.

How the system presents and formats the response:
-------------------------------------------------
- Always formats using markdown.
- Defaults to using between 1 to 10 bullet points, unless instructed otherwise. 
- Includes links to items using their uuid property in the format: [text](${PROMPT_URL_TOKEN_PREFIX}/uuid).
- An introductory or concluding statement is never provided, unless specifically asked to do so.
- Uses simple language where possible. For example use the word "started" instead of "initiated".
- Does not use titles and descriptions directly but paraphrases them.
- For each item or item and its child/linked items, the summary is concise and with a maximum of 25 words, unless the instructions require a different format.

What the system cannot do:
---------------------------
- The system does not have the ability to answer questions or provide additional information beyond what is provided in the data.
- The system does not have the ability to ask follow-up questions or provide additional context beyond what is provided in the data.
`;
}

export const CUSTOM_PROMPT_EXAMPLES: PromptExample[] = [
    {
        description: `Here is the data you need to use:
<example_data>
# Title
User Onboarding v2

## Properties
Type: Document
uuid: a72b6d83-b552-4e60-aeee-21629bbb2ef5

## Recent Changes
Tina: Updated
Tina, Mike: 4 comments

## Document Edits
<added>New user flow diagrams</added>
<added>Welcome email copy</added>

# Title
Q4 Financial Forecast

## Properties
Type: Document
uuid: 2aadff3e-8f34-4e2f-8f8c-d218e3db8713
Meeting Date: 2024-07-22
Type: Financial Planning

## Recent Changes
Robert: Updated
Robert, Lisa: 6 comments

## Document Edits
<added>Revenue projections by product line, including sensitivity analysis for market fluctuations</added>
<removed>Cost reduction initiatives with detailed ROI calculations and implementation timelines</removed>
<added>Cash flow analysis with three scenarios (best, base, worst) considering potential economic downturns</added>
<added>EBITDA targets for upcoming fiscal year, broken down by quarter and business unit</added>
<added>Impact assessment of potential market disruptions, including supply chain issues and regulatory changes</added>
<removed>Capital expenditure plans aligned with strategic initiatives, detailing project priorities and expected outcomes</removed>

# Title
Bug Triage Meeting Notes
uuid: 4bb33546-249d-4523-b83b-2648581ec926

## Properties
Type: Document

## Recent Changes
Dev Team: Updated
Dev Team: 8 comments

## Document Edits
<added>Prioritized bug list</added>
<added>Fix timeline</added>
<removed>Resolved issues</removed>

# Title
Global Marketing Strategy

## Properties
Type: Document
uuid: c8834522-acdc-4ddd-8ec9-fba7e742832d
Meeting Date: 2024-07-24
Type: Strategy and Vision

## Recent Changes
Sarah: Updated
Sarah, John: 5 comments

## Document Edits
<added>Regional campaign ideas tailored to local cultural nuances and consumer behaviors
Budget allocation by channel, with ROI projections and flexibility for real-time optimization
Influencer partnership proposals, including engagement metrics, cost analysis, and brand alignment assessments<</added>
<added>Brand messaging guidelines to ensure global consistency with local relevance, including tone of voice adaptations</added>
<added>Competitive analysis of marketing strategies in key markets, with actionable insights for differentiation</added>
<removed>Content localization workflow to improve efficiency and maintain brand integrity across markets</removed>

# Title
Product Beta Feedback

## Properties
Type: Document
uuid: cd2b08a1-364a-4417-a5b5-030f963e10c3

## Recent Changes
UX Team: Updated
UX Team, Product: 7 comments

## Document Edits
<added>User testing results summary</added>
<added>Feature request list</added>
<removed>Invalid bug reports</removed>

# Title
HR Policy Updates 2024

## Properties
Type: Document
Meeting Date: 2024-07-26
Type: Internal Policy

## Recent Changes
HR Department: Updated
HR, Legal: 3 comments

## Document Edits
<added>New remote work guidelines, including eligibility criteria, performance metrics, and equipment provisions</added>
<removed>Parental leave policy to include secondary caregivers, adoption scenarios, and gradual return-to-work options</removed>
<added>Updated code of conduct with specific examples of acceptable and unacceptable behaviors in various work settings</added>
<removed>Outdated dress code section, replaced with general professionalism guidelines for in-office and virtual interactions</removed>
<added>Mental health support initiatives and resources for employees, including confidential counseling services and stress management workshops</added>
<removed>Diversity and inclusion policies with measurable goals, initiatives, and accountability measures for leadership</removed>
</example_data>

Here are the instructions:

<example_instructions>
Summarize into two sections: "Key updates" where you call out important updates up to a maximum of 3 bullet points and "Action items" where you call out any action items. For both of these also include the people involved, if any.
</example_instructions>
`,
        idealOutput: `## Key updates

* [Q4 Financial Forecast](item-1756bc67-uuid/2aadff3e-8f34-4e2f-8f8c-d218e3db8713) - Robert and Lisa added comprehensive revenue projections, cash flow analysis with three scenarios, and EBITDA targets while removing cost reduction initiatives and capital expenditure plans
* [Global Marketing Strategy](item-1756bc67-uuid/c8834522-acdc-4ddd-8ec9-fba7e742832d) - Sarah and John added regional campaign ideas, budget allocation by channel, and competitive analysis while removing content localization workflow
* [HR Policy Updates 2024](item-1756bc67-uuid/undefined) - HR Department and Legal updated remote work guidelines and code of conduct while removing parental leave policy and diversity initiatives

## Action items

* [Bug Triage Meeting Notes](item-1756bc67-uuid/4bb33546-249d-4523-b83b-2648581ec926) - Dev Team created prioritized bug list and fix timeline
* [Product Beta Feedback](item-1756bc67-uuid/cd2b08a1-364a-4417-a5b5-030f963e10c3) - UX Team and Product compiled user testing results and feature request list`,
    },

    {
        description: `Here is the data you need to use:
<example_data>
# Title
Implement user authentication system

## Properties
Type: Task
uuid: aebb8f67-8d33-42b9-be97-7c7f933ed0f4
Status: In Progress
Status Category: In Progress
Task: ABC-123
Assignee: Emily Chen
Priority: High

## Recent Changes
Emily Chen: To Do → In Progress
Emily Chen: Priority: from Medium to High

# Title
Optimize database queries for improved performance

## Properties
Type: Task
uuid: 73be5f6c-7094-4870-ad5c-3fc4529e9b3d
Status: Code Review
Status Category: In Progress
Task: ABC-456
Assignee: Alex Johnson
Priority: Medium

## Recent Changes
Alex Johnson: In Progress → Code Review
Alex Johnson: Description updated

# Title
Design and implement new user onboarding flow

## Properties
Type: Task
uuid: d7c4bd00-5ffe-4e5d-947e-3771ed259816
Status: To Do
Status Category: To Do
Task: ABC-789
Assignee: Sarah Lee
Priority: High

## Recent Changes
Sarah Lee: Created
Sarah Lee: Priority: from Medium to High

# Title
Fix bug in payment processing module

## Properties
Type: Task
uuid: 94099c2a-1f30-42ea-8416-3e140a291303
Status: In Progress
Status Category: In Progress
Task: ABC-234
Assignee: Michael Brown
Priority: Critical

## Recent Changes
Michael Brown: To Do → In Progress
Michael Brown: Priority: from High to Critical

# Title
Create automated test suite for backend API

## Properties
Type: Task
uuid: d43ea49e-a320-425f-bd66-7e04ea3dc6af
Status: Staging
Status Category: Done
Task: ABC-567
Assignee: Rachel Kim
Priority: Medium

## Recent Changes
Rachel Kim: In Progress → Staging
Rachel Kim: Description updated

# Title
Implement dark mode for mobile app

## Properties
Type: Task
uuid: 57114973-4b08-41f2-a31c-f44070d00da3
Status: To Do
Status Category: To Do
Task: ABC-890
Assignee: David Garcia
Priority: Low

## Recent Changes
David Garcia: Created
David Garcia: Assignee: from Unassigned to David Garcia
</example_data>

Here are the instructions:
<example_instructions>
Structure the summary into the following sections:
1. Work In Progress
2. Work Completed
3. Everything Else

For each section, use two numbered bullet points. The first should summarize highlights from 3-4 relevant items. The second bullet point should include a short summary of everything else. 
</example_instructions>
`,

        idealOutput: `## Work In Progress

1. **Critical and high priority development underway:** [Fix bug in payment processing module](item-1756bc67-uuid/94099c2a-1f30-42ea-8416-3e140a291303) escalated to Critical priority and moved to In Progress by Michael Brown, [Implement user authentication system](item-1756bc67-uuid/aebb8f67-8d33-42b9-be97-7c7f933ed0f4) elevated to High priority and advanced to In Progress by Emily Chen, and [Optimize database queries for improved performance](item-1756bc67-uuid/73be5f6c-7094-4870-ad5c-3fc4529e9b3d) progressed to Code Review stage by Alex Johnson.

2. **Additional active work:** All other in-progress tasks are maintaining steady development momentum with regular updates and priority adjustments.

## Work Completed

1. **Backend testing infrastructure delivered:** [Create automated test suite for backend API](item-1756bc67-uuid/d43ea49e-a320-425f-bd66-7e04ea3dc6af) completed and moved to Staging by Rachel Kim with updated documentation.

2. **No other completed items:** All remaining tasks are either in development or awaiting start.

## Everything Else

1. **New high-priority initiatives queued:** [Design and implement new user onboarding flow](item-1756bc67-uuid/d7c4bd00-5ffe-4e5d-947e-3771ed259816) created and prioritized as High by Sarah Lee, ready for development start.

2. **Lower priority backlog:** [Implement dark mode for mobile app](item-1756bc67-uuid/57114973-4b08-41f2-a31c-f44070d00da3) assigned to David Garcia as Low priority enhancement work.`,
    },
];

export function getCustomPromptPrompt(prompt: string, ianaZone: string, body: string): PromptResult {
    const userMessage = `Here is the data to use:

<data>
${body}
</data>

Here are the instructions:
<instructions>
${prompt}
</instructions>

Once you have followed the instructions, review and verify:
- Ensure the response follows all instructions.
- If details from descriptions, comments, and other properties are available, ensure they are used to create a more useful summary.
- Verify that all links are correctly formatted: [text](${PROMPT_URL_TOKEN_PREFIX}/uuid).
- Verify that you have only used the information provided in the <data> tag.
`;

    let systemMessage = getSystemPrompt(ianaZone);
    systemMessage += `

Examples of how to summarize information provided. These examples are for a stylistic reference only and should NEVER be used in a response:
<examples>
${CUSTOM_PROMPT_EXAMPLES.map(exampleToString).join('\n')}
</examples>`;

    const messages = getChatMessagesWithExamples(
        {
            system: systemMessage,
            examples: [],
        },
        userMessage,
    );

    return { id: 'custom_prompt', messages };
}
