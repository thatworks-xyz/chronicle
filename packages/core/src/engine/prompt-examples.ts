import { PromptExample } from '../llm/messages.js';
import { PROMPT_URL_TOKEN_PREFIX } from './url-processor.js';

export const DEFAULT_HIGHLIGHTS_PROMPT_EXAMPLES: PromptExample[] = [
    {
        description: `Summarize using 3 bullet points:
                
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
<removed>Diversity and inclusion policies with measurable goals, initiatives, and accountability measures for leadership</removed>`,
        idealOutput: `* [User Onboarding v2](${PROMPT_URL_TOKEN_PREFIX}/a72b6d83-b552-4e60-aeee-21629bbb2ef5): Updated with new user flow diagrams and modified welcome email copy. Tina and Mike contributed 4 comments.
* [Financial Forecast](${PROMPT_URL_TOKEN_PREFIX}/2aadff3e-8f34-4e2f-8f8c-d218e3db8713Q4): Comprehensive updates including revenue projections, cost reduction initiatives, cash flow analysis, EBITDA targets, market disruption impact assessment, and capital expenditure plans. Robert and Lisa added 6 comments.
* Bug Triage Meeting Notes, Product Beta Feedback, and HR Policy Updates 2024: Added [prioritized bug list and fix timeline](${PROMPT_URL_TOKEN_PREFIX}/4bb33546-249d-4523-b83b-2648581ec926); included [user testing results and updated feature request list](${PROMPT_URL_TOKEN_PREFIX}/c8834522-acdc-4ddd-8ec9-fba7e742832d); introduced [new remote work guidelines, modified parental leave policy, and updated code of conduct](${PROMPT_URL_TOKEN_PREFIX}/cd2b08a1-364a-4417-a5b5-030f963e10c3). Various team members contributed comments and updates.`,
    },

    {
        description: `Summarize them using between 2 to 3 bullet points:

# Title
Implement user authentication system

## Properties
Type: Task
uuid: aebb8f67-8d33-42b9-be97-7c7f933ed0f4
Status: In Progress
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
Task: ABC-890
Assignee: David Garcia
Priority: Low

## Recent Changes
David Garcia: Created
David Garcia: Assignee: from Unassigned to David Garcia`,

        idealOutput: `* [User authentication system](${PROMPT_URL_TOKEN_PREFIX}/aebb8f67-8d33-42b9-be97-7c7f933ed0f4) implementation and [payment processing](${PROMPT_URL_TOKEN_PREFIX}/94099c2a-1f30-42ea-8416-3e140a291303) bug fix are in progress 
* [Database query optimization](${PROMPT_URL_TOKEN_PREFIX}/73be5f6c-7094-4870-ad5c-3fc4529e9b3d) moved to Code Review, while [new user onboarding flow design](${PROMPT_URL_TOKEN_PREFIX}/d7c4bd00-5ffe-4e5d-947e-3771ed259816) was created
* [Backend API automated test suite](${PROMPT_URL_TOKEN_PREFIX}/d43ea49e-a320-425f-bd66-7e04ea3dc6af) advanced to Staging, and [dark mode implementation for mobile app](${PROMPT_URL_TOKEN_PREFIX}/57114973-4b08-41f2-a31c-f44070d00da3) was assigned to David Garcia with Low priority.`,
    },
    {
        description: `Summarize them using 1 bullet point: 

# Title
Sustainability Initiative 2025

## Properties
Type: Document
uuid: 12a985bf-b597-47ba-b8d2-0387a9e1458d
Meeting Date: 2024-07-30
Type: Corporate Strategy

## Recent Changes
Green Team: Updated
Green Team, Executive Board: 6 comments

## Document Edits
<added>Carbon footprint reduction goals with yearly targets and detailed measurement methodology
Renewable energy adoption plan, including feasibility studies for on-site generation and power purchase agreements
-friendly product development roadmap with materials and packaging innovations, aligned with circular economy principles</added>
<added>Sustainability reporting metrics aligned with GRI Standards and SASB guidelines, with data collection processes</added>
<added>Supply chain sustainability assessment and improvement plan, including supplier engagement strategies and auditing procedures</added>
<removed>Employee engagement programs for sustainability initiatives, including green teams, volunteer opportunities, and incentive structures</removed>`,
        idealOutput: `[Sustainability Initiative 2025](${PROMPT_URL_TOKEN_PREFIX}/12a985bf-b597-47ba-b8d2-0387a9e1458d) document comprehensively updated, covering carbon reduction, renewable energy, eco-friendly product development, reporting metrics, supply chain assessment, and employee engagement, with recent changes to the Green Team section and comments from both the Green Team and Executive Board.`,
    },
    {
        description: `Summarize using between 2 to 3 bullet points: 

# Title
Dropdown menu not closing on outside click

## Properties
Type: Bug
uuid: 97a26ade-b209-4e6a-8172-c9d4a339b2ba
Status: done

# Title
Image upload fails for files larger than 5MB

## Properties
Type: Bug
uuid: 4114b849-0e85-4086-a394-79cdeb7e47fc
Status: done

# Title
Search functionality not working with special characters

## Properties
Type: Bug
uuid: fae3bc09-305b-43d8-ab8d-a3d3a9a899a0
Status: done

# Title
Incorrect date format displayed in user profiles

## Properties
Type: Bug
uuid: c6523b65-8d79-4ead-98fe-516db5ef1a46
Status: done

# Title
Login page unresponsive on mobile devices

## Properties
Type: Bug
uuid: 8a1ea5c8-394b-4885-a068-e25e4be90cde
Status: done`,
        idealOutput: `* Several bugs have been resolved, including [issues with the dropdown menu](${PROMPT_URL_TOKEN_PREFIX}/97a26ade-b209-4e6a-8172-c9d4a339b2ba), [image upload limitations](${PROMPT_URL_TOKEN_PREFIX}/4114b849-0e85-4086-a394-79cdeb7e47fc), and [search functionality with special characters](${PROMPT_URL_TOKEN_PREFIX}/fae3bc09-305b-43d8-ab8d-a3d3a9a899a0).
* Additional fixes addressed [incorrect date formatting in user profiles](${PROMPT_URL_TOKEN_PREFIX}/c6523b65-8d79-4ead-98fe-516db5ef1a46) and [login page responsiveness on mobile devices](${PROMPT_URL_TOKEN_PREFIX}/8a1ea5c8-394b-4885-a068-e25e4be90cde).`,
    },
    {
        description: `Summarize using 1 bullet point: 

# Title
John Smith

## Properties
Type: page
uuid: 54d9eaaf-1bae-4d1b-89ee-b0aaf846003d

## Recent Changes
Jim: Updated

## Document Edits
<removedf</removed>
<added>q</added>
</user>
<assistant>
* [John Smith's](${PROMPT_URL_TOKEN_PREFIX}/54d9eaaf-1bae-4d1b-89ee-b0aaf846003d) page was updated by Jim, with minor edits.
</assistant>
</example>
<example>
<user>
Total number of items: 1. Summarize using 1 bullet point:

## Title
Security Audit

## Properties

Type: page
uuid: c7fff9c9-4a59-4aa4-aa66-e81f4ecb6e86
Status Category: to do

## Recent Changes
Smith: Created`,
        idealOutput: `* [Security Audit](${PROMPT_URL_TOKEN_PREFIX}/c7fff9c9-4a59-4aa4-aa66-e81f4ecb6e86) page created by Smith and is pending.`,
    },
];
