# Master System Architecture: Global Educational ERP & LMS

## 1. Project Overview
This system is a multi-tenant, comprehensive Educational Enterprise Resource Planning (ERP) platform and Learning Management System (LMS). It is designed to manage a network of schools, handling the absolute lifecycle of both students (enrollment to alumni status) and staff (onboarding to retirement). 

Performance, global edge delivery, and real-time collaboration are critical priorities.

## 2. Technology Stack
* **Infrastructure & Compute:** Cloudflare Workers (Edge computing for global low latency).
* **Database:** Serverless PostgreSQL (e.g., Supabase, Neon) with an edge-compatible ORM (like Drizzle).
* **Frontend:** React (Next.js) with Tailwind CSS for rapid UI development.
* **Real-Time Infrastructure:** Cloudflare Durable Objects / WebSockets for live features.
* **AI Integration Engine:** Gemma 4 (deployed via API) for intelligent tutoring assistance and automated reasoning hints.

## 3. Core Modules & System Boundaries

### Module 1: Identity & Multi-Tenant Routing (The Core)
* **Tenant Management:** Hierarchy handling (Network/Super Admin -> School Branch -> Department).
* **Role-Based Access Control (RBAC):** Strict isolation between Super Admins, Branch Managers, Teachers, Students, and Parents.
* **Audit Logging:** Immutable logs for state changes (e.g., grading modifications, staff promotions).

### Module 2: Human Resources & Staff Lifecycle
* **Recruitment & Onboarding:** Document collection, contract generation, and credential verification.
* **Assignment Routing:** Assigning staff to specific branches, departments, and class rosters.
* **Performance & Payroll:** Evaluation tracking, attendance logging, and salary disbursement histories.
* **Offboarding/Retirement:** Access revocation, knowledge transfer logging, and alumni-staff status updates.

### Module 3: Student Information System (SIS) Lifecycle
* **Admissions Funnel:** Application processing, entrance exam tracking, and fee collection.
* **Academic Progression:** Class assignments, automated transcript generation, and term-over-term promotion logic.
* **Graduation & Alumni:** Degree issuance, credential verification, and alumni network tracking.

### Module 4: Advanced LMS & Real-Time Classroom
* **Curriculum Delivery:** Syllabus management, asynchronous assignment uploads, and grading rubrics.
* **Real-Time Collaboration (RTC):** WebSocket-driven interactive whiteboards for remote tutoring and live class sessions.
* **AI Tutor Copilot:** Secured endpoints routing student queries/whiteboard context to the Gemma 4 model to generate real-time hints and derivations for educators.

## 4. High-Level Relational Database Entities (Core ERD)
* `Organizations`: ID, Name, Global Settings.
* `Branches`: ID, Org_ID, Location, Status.
* `Users`: ID, Role, Global_Status.
* `Staff_Profiles`: User_ID, Hire_Date, Branch_ID, Department, Retirement_Date.
* `Student_Profiles`: User_ID, Enrollment_Date, Cohort_Year, Status (Active/Graduated/Dropped).
* `Classes`: ID, Branch_ID, Subject, Term.
* `Enrollments`: Student_ID, Class_ID, Final_Grade.
* `Staff_Assignments`: Staff_ID, Class_ID, Role (Lead/Assistant).

## 5. Strict AI Developer Guidelines
When writing code for this system, the AI agent MUST adhere to the following rules:
1.  **Modularity:** Build features as isolated, stateless functions whenever possible to align with the edge-worker architecture.
2.  **Zero Hallucination UI:** Do not invent complex frontend components unless instructed. Use standard, accessible UI libraries.
3.  **Test-Driven Execution:** For every backend endpoint or database schema generated, write the corresponding test suite before moving on.
4.  **Security First:** Never trust client-side data. Enforce RBAC checks on every single API route.