-- Credibility Test Training: one editable video, a managed question bank, and every practice attempt with its score.
create table if not exists portal_cred_settings (
  id int primary key default 1 check (id = 1),
  video_url text, video_id text, title text, description text,
  updated_by text, updated_at timestamptz not null default now()
);
create table if not exists portal_cred_questions (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  question text not null check (char_length(question) between 5 and 400),
  category text not null default 'general',
  guidance text, model_answer text,
  active boolean not null default true,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists portal_cred_questions_pos on portal_cred_questions(position);
create table if not exists portal_cred_attempts (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  application_id text references portal_applications(application_id) on delete set null,
  question_id uuid references portal_cred_questions(id) on delete set null,
  question_text text not null, category text not null default 'general',
  answer text not null check (char_length(answer) between 1 and 3000),
  answer_hash text,
  score int not null check (score between 0 and 100), band text not null,
  criteria jsonb not null default '{}'::jsonb,
  did_well jsonb not null default '[]'::jsonb, missing jsonb not null default '[]'::jsonb,
  improve jsonb not null default '[]'::jsonb, suggestions jsonb not null default '[]'::jsonb,
  summary text, flags jsonb not null default '[]'::jsonb,
  mode text not null default 'ai',
  created_at timestamptz not null default now()
);
create index if not exists portal_cred_attempts_student on portal_cred_attempts(student_email, created_at desc);
create index if not exists portal_cred_attempts_question on portal_cred_attempts(question_id, answer_hash);
alter table portal_cred_settings enable row level security;
alter table portal_cred_questions enable row level security;
alter table portal_cred_attempts enable row level security;

insert into portal_cred_settings (id, video_url, video_id, title, description) values (
  1, 'https://youtu.be/KsvzkB-po-I', 'KsvzkB-po-I',
  'How to pass your Regent College London credibility interview',
  'Watch this first. It explains what the interviewer is looking for and how to prepare answers that are genuinely yours. Then practise the questions below.'
) on conflict (id) do nothing;

insert into portal_cred_questions (position, question, category, guidance) select * from (values
 (1, 'Why have you chosen this course at Regent College London, and how does it connect to what you have studied or done before?', 'course', E'Link three things in your own words: what you studied or did before, the course, and where you want to go.\nSay why this course fits you personally, not why the subject is "good".\nMention something specific from your own background that led you here.'),
 (2, 'Tell me about the modules you will study. Which ones interest you most, and why?', 'course', E'Name real modules from your course page and say what each one actually covers.\nExplain which skills each module gives you and how they connect to your career plan.\nDo not guess. If you are unsure, go back and read the module list again.'),
 (3, 'Why Regent College London and not another institution?', 'university', E'Give reasons that belong to Regent specifically: the course content, the location, the teaching, support or links that matter to you.\nCompare honestly with at least one other option you looked at.\nAvoid general praise such as "good reputation" without saying what that means for you.'),
 (4, 'Why do you want to study in the UK rather than at home or in another country?', 'uk', E'Explain what the UK offers for this particular course that you cannot get elsewhere.\nBe specific and honest about your reasons.\nShow that you have thought about alternatives.'),
 (5, 'What do you plan to do when you finish your studies, and how will this course help?', 'career', E'Describe a realistic plan that follows on from your past experience.\nName the kind of role or work you want and what you will use from the course.\nSay where you plan to work and why that makes sense.'),
 (6, 'How long is your course, and how have you planned for the full time you will spend in the UK?', 'finance', E'Know the exact course length, start date and end date.\nShow that your budget covers the whole course, not only the first part.\nDo not give a generic answer that could belong to any course.'),
 (7, 'How much are your tuition fees, and how much money do you need for living costs?', 'finance', E'Know the exact tuition fee, what you have already paid and what is left.\nKnow the living-cost amount you must show for your location.\nUse the real figures from your own application.'),
 (8, 'Who is paying for your studies, and where does that money come from?', 'finance', E'Name your sponsor and your relationship to them. Know how they earn their income.\nBe able to explain where the funds in the account came from. Large or recent deposits need a clear, documented reason.\nOnly say what is true and what your documents can support.'),
 (9, 'Tell me about your education and work history. Is there any gap, and what were you doing?', 'background', E'Walk through your timeline in order and be consistent with your CV and documents.\nIf there is a gap, say plainly what you were doing and be ready to show evidence.\nKeep it honest and match what you submitted.'),
 (10, 'Have you applied for a visa to any country before? Tell me what happened.', 'background', E'Be completely honest. Not mentioning an earlier refusal is far worse than explaining it.\nIf there was a refusal, explain what happened in simple terms.\nIf you have never applied, say so clearly.'),
 (11, 'Why this course at this institution in the UK, for your future?', 'combined', E'This is the big picture. Your answer should sound like one connected plan: your past, then the course and its modules, then Regent, then the UK, then your career.\nEach part should lead naturally to the next.\nIt should sound like you, not like something you learned by heart.')
) as v(position, question, category, guidance)
where not exists (select 1 from portal_cred_questions);
