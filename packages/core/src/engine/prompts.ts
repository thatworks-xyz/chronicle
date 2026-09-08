import { ChatMessage, getChatMessagesWithExamples, PromptExample } from '../llm/messages.js';
import { PromptResult } from '../llm/prompt-processor.js';
import { ActivityItemGraph } from './activity-graph.js';
import { DEFAULT_HIGHLIGHTS_PROMPT_EXAMPLES } from './prompt-examples.js';
import { PROMPT_URL_TOKEN_PREFIX } from './url-processor.js';

export function getCommentDiscussionSummaryPromptV4(body: string, maxBulletPoints: number): PromptResult {
    const userMessage = `Here are the conversations you need to summarize. They are a list of items, such as the name of a task, document, or chat channel. . Each item has a list of recent discussions. 

<data>
${body}
</data>

Please follow these instructions to create the summary:

- Summarize all of them using between 1 and ${maxBulletPoints} concise bullet points
- Group them by themes where possible. Each bullet point should encapsulate a main topic or theme from the discussion
- Focus on capturing the key points such as actions specific people need to take (if available) while maintaining brevity.
- Avoid unnecessary details and strive for a concise yet comprehensive summary.
- If there are insufficient details to summarize, then only paraphrase the discussions provided. Do not mention anything else, such as the lack of information.
- Do not provide a and introductory or concluding statement.`;

    const messages = getChatMessagesWithExamples(
        {
            system: 'You help summarize discussions, such as comments or chat messages, for easy to read summaries. You only do this and do not respond as a chat bot.',
            examples: [
                {
                    description: `# Title: User Authentication: Implementing [Two-Factor] [method] [SMS] causes system crash

Alex Wong: I've identified the issue in our authentication module. It seems to be related to how we're handling SMS responses.

Sarah Kim: Thanks for looking into this, Alex. Have you checked if it's specific to certain mobile carriers?

Alex Wong: Good point, Sarah. I've tested with major carriers and the crash occurs consistently. It might be an issue with our SMS gateway integration.

Raj Patel: I can assist with the SMS gateway debugging if needed. Let me know if you want me to take a look.

# Title: Analytics dashboard fails to load when more than 500 data points are selected

Lisa Chen: I've reproduced this issue on multiple browsers. It seems our rendering engine is struggling with large datasets.

Tom Jackson: Lisa, have you tried implementing pagination or lazy loading for the data points?

# Title: API rate limiting not working correctly for enterprise customers

Mark Rodriguez: Our enterprise customers are reporting that they're hitting rate limits despite their higher tier access. I've confirmed this in our logs.

# Title: [Mobile App] Push notifications not delivering on iOS devices

Sophia Martinez: We're seeing a significant drop in push notification deliveries for our iOS users over the past week. Android seems unaffected.

Liam Wilson: I've dealt with similar APNS issues before. Let's schedule a pair programming session to debug this together.`,
                    idealOutput: `* User Authentication: SMS-based two-factor authentication causing system crashes; Alex to investigate SMS gateway integration, Raj offered assistance with debugging.
* Analytics Dashboard: Rendering engine struggling with large datasets (>500 data points); Tom suggested implementing pagination or lazy loading.
* API and Mobile App Issues: Enterprise customers hitting incorrect rate limits; Mark confirmed in logs. iOS push notifications not delivering; Sophia and Liam to debug APNS issues together.`,
                },
                {
                    description: `# Title: Database migration script failing on production environment

Emily Chang: The migration script we tested in staging is failing when run on the production database. I'm seeing a timeout error.

David Lee: Can you share the exact error message? I'll take a look at the script to see if there are any obvious issues.

# Title: User profile pictures not displaying after CDN switch

Michael Johnson: Several users have reported that their profile pictures are not showing up since we switched to the new CDN.

# Title: [Frontend] Dark mode toggle causing layout shift on mobile devices

Aisha Patel: Note to self: need to read up the docs and confirm if this is expected.`,
                    idealOutput: `* Database Migration: Script failing in production with timeout error; David asked for the error message.
* CDN and Frontend Issues: User profile pictures not displaying after CDN switch; Dark mode toggle causing layout shift on mobile devices, Aisha to research if this is expected behavior.`,
                },
            ],
        },
        userMessage,
    );

    return { id: 'comment_discussion', messages };
}

export interface BulletPoint {
    text: string;
    subBullets: string[];
}

export function makeIndentedBulletPoint(index: number, bullet: BulletPoint): string {
    const bulletPoint = `${index + 1}. ${bullet.text}`;
    if (bullet.subBullets.length === 0) {
        return bulletPoint;
    }

    const subBulletPoints = bullet.subBullets.map((subBullet) => {
        return `   - ${subBullet}`;
    });

    return `${bulletPoint}\n${subBulletPoints.join('\n')}`;
}

export function getDefaultPromptV4(
    body: string,
    props: {
        numHighlightedItems: number;
        includesFullDocument: boolean;
        bulletPoints?: { min: number; max: number };
        dataInstructions?: BulletPoint;
        examplesOverride?: PromptExample[];
    },
): PromptResult {
    let bulletPrompt = `Use between 2 to 3 bullet points`;
    if (!props.bulletPoints) {
        // > ActivityItemGraph.MIN_NUM_ITEMS_TO_HIGHLIGHT means the user is looking for more detail
        if (props.numHighlightedItems > ActivityItemGraph.MIN_NUM_ITEMS_TO_HIGHLIGHT) {
            bulletPrompt = `Structure the summary using bullet points, with a minimum of 1 and a maximum of 10 bullet points. If possible, group similar items together while still ensuring enough details are provided for each item. Do not leave any items out of the summary.`;
        } else {
            if (props.numHighlightedItems > 3) {
                bulletPrompt = `Use 3 bullet points`;
            } else if (props.numHighlightedItems === 1) {
                bulletPrompt = `Use exactly 1 bullet point`;
            }

            if (props.includesFullDocument) {
                bulletPrompt = `Use between 2 to 3 bullet points`;
            }
        }
    } else {
        bulletPrompt = `Use between ${props.bulletPoints.min} to ${props.bulletPoints.max} bullet points`;
    }

    const instructionSteps: BulletPoint[] = [
        {
            text: 'What to summarize:',
            subBullets: [
                `Use information that creates a useful summary and calls out actionable followups. Prefer calling out actions if available.`,
                `If there is insufficient information, then only use the information provided.`,
                `If child or linked items are mentioned, summarize them along with the parent item.`,
                `Sometimes a property called "Status Category" is used to indicate the status of an item and should not be directly referenced but must be used to determine the status and tense of the summary.`,
                `For meetings and emails, include the names of people if available. `,
                `For comments and discussions, include them if they provide additional context.`,
            ],
        },
        {
            text: `Presentation:`,
            subBullets: [
                `${bulletPrompt}`,
                `Use simple language where possible. For example use the word "started" instead of "initiated".`,
                `Do not use titles and descriptions directly but paraphrase them. If the title includes text along with a uuid, then ignore the uuid.`,
                `For each item, create a link around the relevant text. Ensure it is formatted as markdown as shown in the examples, where the URL uses a token "${PROMPT_URL_TOKEN_PREFIX}" followed by the item's uuid property [text](${PROMPT_URL_TOKEN_PREFIX}/uuid).`,
                `If child or linked items are being mentioned, then include their links too.`,
                `For each item or item and its child/linked items, ensure the summary is concise and with a maximum of 25 words.`,
                `If it is a document or meeting notes, then include key points, completed actions, and pending actions. Completed actions might be denoted using specific words or with a [x] mark.`,
            ],
        },
    ];

    if (props.dataInstructions) {
        instructionSteps.push(props.dataInstructions);
    }

    instructionSteps.push(
        {
            text: `Never do the following:`,
            subBullets: [
                `Do not provided an introductory statement.`,
                `Never ask a follow up question.`,
                `Never use the first person.`,
                `Do not add information that is not provided.`,
                `Do not provide a concluding statement.`,
            ],
        },
        {
            text: `Review and refine:`,
            subBullets: [
                `Ensure your summary captures the most important information.`,
                `If details from descriptions, comments, and other properties are available, ensure they are used to create a more useful summary.`,
                `Check that you have the correct number of bullet points.`,
                `Verify that all links are correctly formatted.`,
            ],
        },
    );

    const userMessage = `You are an AI assistant specializing in summarizing work activities for reporting purposes. Your audience is people in a workplace who you can assume to be knowledgeable about the subjects you summarize. Your task is to analyze the provided data and create a concise summary.

Here is the data you need to summarize.

<data>
${body}
</data>

Please follow these steps to create your summary:

${instructionSteps.map((step, si) => makeIndentedBulletPoint(si, step)).join('\n\n')}
`;

    const messages = getChatMessagesWithExamples(
        {
            system: `You help summarize work activities for reporting.`,
            examples: props.examplesOverride || DEFAULT_HIGHLIGHTS_PROMPT_EXAMPLES,
        },
        userMessage,
    );

    return { id: 'activity_highlights', messages };
}

export function getReleaseNotesPromptV4(body: string): PromptResult {
    const userMessage = `<input>
${body}
</input>

You have been provided with a list of items, their properties, and recent changes in the <input> tag. Using previously provided examples as a style reference, write a summary of work in the style of a detailed changelog with these instructions:

Presentation:
- Always use a single bullet point for each item and reference the titles and paraphrase where possible.
- If there is insufficient information then just use the title of the item.
- Include each item's uuid property as a markdown link as shown in the examples. 
- If child or linked items are mentioned, summarize them along with the parent item and include markdown links where possible.
- For documents, meetings and emails, include the names of people if available. Also include any pending and completed actions, decisions, outcomes, or next steps. Completed actions might be denoted using specific words or with a [x] mark.

Grouping:
- Group related bullet points together into a minimum of 1 and a maximum of 4 separate sections.
- If some items are not related, then provide a single bullet point for each under a section with the title "Other Changes".
- Do not group and create sections if there are too few items to do so.
- If there is only one item then you will provide a single bullet point with no grouping.

Things not to do:
- Never ask a follow up question.
- Never use the first person.
- Do not add information that is not provided.
- Do not provide a concluding statement.`;

    const messages = getChatMessagesWithExamples(
        {
            system: `You help write a summary of work in the style of a detailed changelog.`,
            examples: [
                {
                    description: `# Title
Implement user profile picture upload feature
## Properties
Type: Feature
uuid: f5e120d6-16ef-432e-8fbe-8ff00ef6eed9
Status: Completed
Status Category: done
Description: Add functionality for users to upload and update their profile pictures, including image cropping and resizing.

# Title
Fix cross-site scripting (XSS) vulnerability in comment system
## Properties
Type: Task
uuid: 40ad8054-a4ef-4ca9-83e9-fb5ca91285a1
Status: Resolved
Status Category: done

# Title
Page load times have regressed for product catalog
## Properties
Type: Bug
uuid: 6e609d72-f121-4a56-8bbd-2ec221dd3904
Status: Completed
Status Category: done
Description: Page load times are taking 5x longer

# Title
Migrate user data to new cloud infrastructure
## Properties
Type: Task
uuid: cc24de70-d09d-4d81-b412-748be0b8257a
Status: Completed
Status Category: done
Description: Successfully migrated all user data from on-premises servers to the new cloud infrastructure with zero data loss and minimal downtime.

# Title
Implement multi-language support for mobile app
## Properties
Type: Sub-task
uuid: 5e610d3f-75b5-4ffd-b7ef-c43951b6c9ed
Status: Completed
Status Category: done
Description: Add support for 5 additional languages in the mobile app, including localization of all UI elements and content.

# Title
Resolve shopping cart abandonment issue
## Properties
Type: Bug
uuid: 8b5cb28f-4168-4ddc-a8ee-d3279d3ee5b4
Status: Completed
Status Category: done
Description: Items to disappear from users' shopping carts, leading to a 15% reduction in cart abandonment rate.

# Title
Implement automated backup system
## Properties
Type: Task
uuid: 99f5690f-5fd3-4cd1-b2db-ff67eea84ec1
Status: Completed
Status Category: done
Description: Set up an automated daily backup system for all critical databases and user-generated content, with redundant off-site storage.

# Title
Redesign onboarding process for new users
## Properties
Type: Task
uuid: ed4950f9-5abc-47c2-bc98-6a65061860a4
Status: Implemented
Status Category: done
Description: Revamp the new user onboarding process with interactive tutorials and progress tracking, resulting in a 25% increase in user activation rates.

# Title
Integrate social media sharing functionality
## Properties
Type: Task
uuid: 0b651bd3-8a02-4af6-8132-4b451213dd3a
Status: Completed
Status Category: done
Description: Add one-click sharing options for popular social media platforms across all product pages and user-generated content.

# Title
Implement GDPR compliance measures
## Properties
Type: Task
uuid: f12482b0-e967-4ae5-8517-a6b641d39af2
Status: Completed
Status Category: done
Description: Update data handling processes, implemented user consent management, and added data export/deletion features to ensure compliance with GDPR regulations.`,
                    idealOutput: `User Experience and Functionality:

* [Implemented](${PROMPT_URL_TOKEN_PREFIX}/f5e120d6-16ef-432e-8fbe-8ff00ef6eed9) user profile picture upload feature with image cropping and resizing capabilities
* [Redesigned](${PROMPT_URL_TOKEN_PREFIX}/ed4950f9-5abc-47c2-bc98-6a65061860a4) onboarding process for new users
* [Added](${PROMPT_URL_TOKEN_PREFIX}/5e610d3f-75b5-4ffd-b7ef-c43951b6c9ed) multi-language support for the mobile app, including localization to multiple languages
* [Integrated](${PROMPT_URL_TOKEN_PREFIX}/0b651bd3-8a02-4af6-8132-4b451213dd3a) social media sharing functionality across product pages and user-generated content

Security and Performance:

* [Fixed](${PROMPT_URL_TOKEN_PREFIX}/40ad8054-a4ef-4ca9-83e9-fb5ca91285a1) cross-site scripting (XSS) vulnerability in the comment system
* [Addressed](${PROMPT_URL_TOKEN_PREFIX}/6e609d72-f121-4a56-8bbd-2ec221dd3904) page load time regression in the product catalog
* [Resolved](${PROMPT_URL_TOKEN_PREFIX}/8b5cb28f-4168-4ddc-a8ee-d3279d3ee5b4) shopping cart abandonment issue which led to a 15% reduction in cart abandonment rate

Infrastructure and Data Management:

* [Migrated](${PROMPT_URL_TOKEN_PREFIX}/cc24de70-d09d-4d81-b412-748be0b8257a) user data to new cloud infrastructure
* [Implemented(${PROMPT_URL_TOKEN_PREFIX}/99f5690f-5fd3-4cd1-b2db-ff67eea84ec1) automated daily backup system for critical databases and user-generated content
* [Updated](${PROMPT_URL_TOKEN_PREFIX}/f12482b0-e967-4ae5-8517-a6b641d39af2) data handling processes to ensure GDPR compliance, including user consent management and data export/deletion features`,
                },
                {
                    description: `# Title
Implement two-factor authentication
## Properties
Type: Task
uuid: 92d2f4c3-6dda-41da-917c-3551391ebe97
Status: Staging
Status Category: done
Description: Design and implement a two-factor authentication system to enhance account security for users.

# Title
Fix broken links in documentation
## Properties
Type: Bug
uuid: d17dacb7-1a64-44e5-be90-b80d06134a6b
Status: Production
Status Category: done
Description: Several broken links have been identified in the product documentation. These need to be updated to ensure users can access all necessary information.`,
                    idealOutput: `* [Implemented](${PROMPT_URL_TOKEN_PREFIX}/92d2f4c3-6dda-41da-917c-3551391ebe97) two-factor authentication system to enhance account security for users
* [Fixed](${PROMPT_URL_TOKEN_PREFIX}/d17dacb7-1a64-44e5-be90-b80d06134a6b) broken links in product documentation, ensuring users can access all necessary information`,
                },
                {
                    description: `# Title
Sentiment Analysis

## Properties
Type: page
uuid: 3be8365a-c4b0-4c46-a9b2-e80831efb4d7

## Document Edits
<added>Case study: Improved CSAT scores
Customer support interactions are a goldmine of insights, but extracting meaningful data can be challenging. Manual analysis is time-consuming, and traditional analytics tools often miss the nuances of customer sentiment.
Enter "Sentiment Analysis" in SupportSphere. This feature automatically processes and visualizes customer sentiment from various touchpoints, including email, chat logs, and phone transcripts.</added>

# Title
Implement AI-powered chatbot for customer support
## Properties
Type: Task
uuid: 2d1c7dae-b0ca-4cec-9eb3-4bedaade5354
Status: Completed
Status Category: done`,
                    idealOutput: `* [Sentiment Analysis](${PROMPT_URL_TOKEN_PREFIX}/3be8365a-c4b0-4c46-a9b2-e80831efb4d7) updated with a case study on improved CSAT scores
* [Implemented](${PROMPT_URL_TOKEN_PREFIX}/2d1c7dae-b0ca-4cec-9eb3-4bedaade5354) AI-powered chatbot for customer support`,
                },
            ],
        },
        userMessage,
    );

    return { id: 'release_notes', messages };
}

export function getCustomFormattingPrompt(body: string): PromptResult {
    const messages: ChatMessage[] = [
        {
            role: 'system',
            content: `You are system that formats text according to specific requirements. You do not behave like a chat bot.

- You will be provided with text that needs to be formatted under <text> tags.
- You will be provided with formatting instructions under the <instruction> tags.
- Formatting instructions may include formatting the differently such as paragraphs or bullet points. They may also include instructions to summarize the text in a certain way. Ignore any instructions that are not related to this.
- If you are unable to follow the instructions, you will return "Unable to apply formatting".
`,
        },
        {
            role: 'user',
            content: `${body}`,
        },
    ];
    return { id: 'custom_formatting', messages };
}
