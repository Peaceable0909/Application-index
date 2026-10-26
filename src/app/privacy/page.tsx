import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { backupKeep } from '@/lib/backup';
import { KEEP_DEFAULT } from '@/lib/backupRetention';
import './privacy.css';

export const metadata = {
  title: 'Privacy policy',
  description: 'How WhiteRock looks after your information when you use the student portal, chat with us or talk to our team.',
};

/** Where questions and requests go. One place, so the policy and the page footer cannot disagree. */
const CONTACT = 'applications.whiterock@gmail.com';
const UPDATED = '26 October 2026';

const SECTIONS = [
  ['who', 'Who we are'], ['collect', 'What we collect'], ['use', 'How we use it'], ['share', 'Who sees it'], ['ai', 'Software and AI'],
  ['services', 'Services we use'], ['where', 'Where it is kept'], ['keep', 'How long we keep it'], ['safe', 'Keeping it safe'],
  ['cookies', 'Cookies and stored settings'], ['team', 'Team members'], ['rights', 'Your choices'], ['changes', 'Changes'],
] as const;

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export default async function Privacy() {
  const [staff, student] = await Promise.all([currentStaff(), currentStudent()]);
  const keep = await backupKeep().catch(() => KEEP_DEFAULT);
  const home = staff ? '/' : student ? '/student' : '/welcome';
  let n = 0;
  const num = () => ++n;

  return (
    <div className={`pp${!staff && !student ? ' pp-open' : ''}`}>
      {/* signed-in people already have the portal around the page, so the bar is only for visitors */}
      {!staff && !student && (
        <header className="pp-top">
          <a href="/welcome" aria-label="WhiteRock home"><Logo height={30} alt="WhiteRock" /></a>
          <a href="/student/login" className="pp-signin">Student sign in</a>
        </header>
      )}

      <div className="pp-wrap">
        <div className="pp-head">
          <a href={home} className="pp-back"><Icon n="left" size={16} /><span>{staff || student ? 'Back to the portal' : 'Back to the front page'}</span></a>
          <h1>Privacy policy</h1>
          <p>How WhiteRock looks after your information when you use the student portal, chat with us or talk to our team.</p>
          <span className="pp-updated">Last updated {UPDATED}</span>
        </div>

        <article className="pp-card">
          <div className="pp-short">
            <h2>The short version</h2>
            <ul>
              <li><Icon n="check" size={16} /><span>We keep the details and documents you give us, and the messages you send, so we can work on your university application.</span></li>
              <li><Icon n="check" size={16} /><span>Your counselor and the WhiteRock team working on your application can see them. Services that run our systems handle them for us. A university sees them only when we apply there for you.</span></li>
              <li><Icon n="check" size={16} /><span>We never sell your information or use it for advertising. The portal has no advertising and no analytics tools.</span></li>
              <li><Icon n="check" size={16} /><span>AI helps our team in a few places, listed in section 5. A person decides what happens with your application, and an automatic AI reply to you is always labelled.</span></li>
              <li><Icon n="check" size={16} /><span>You can ask to see, correct or delete your information at any time. Email <Mail />.</span></li>
            </ul>
          </div>

          <nav aria-label="On this page">
            <ol className="pp-toc">
              {SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
            </ol>
          </nav>

          <section id="who">
            <h2><span>{num()}</span>Who we are</h2>
            <p>
              WhiteRock Educational Services (“WhiteRock”, “we”, “us”) helps students apply to universities. We decide how your information is used. This policy covers the student portal, the chat on our website for new students, the emails and notifications the portal sends you, and the calls and messages between you and our team. Questions about it go to <Mail />.
            </p>
          </section>

          <section id="collect">
            <h2><span>{num()}</span>What we collect</h2>
            <p><strong>When you sign in.</strong> Your email address. If you choose “Continue with Google”, Google also tells us your name and email address. There is no password: we email you a one-time code.</p>
            <p><strong>Your application.</strong> The details you gave on our document form or to your counselor: your name, email, phone number, country and city, date of birth, gender if you gave it, the school and programme you want, your counselor, and how you heard about WhiteRock. We also record where your application is (for example, which stage it has reached, and offer, CAS and visa steps), notes our team writes about it, tasks and reminders, and interview bookings.</p>
            <p><strong>Your documents.</strong> The files you send, such as a passport data page, certificates, transcripts, a CV, references and English test results. They can hold sensitive personal information, so send only what you want us to have for your application. To check them, we also keep what the check finds: the kind of document, the name on it, who issued it, the expiry date, any warning, and the text read from it.</p>
            <p><strong>Messages and calls.</strong> What you send in the chat with your counselor: text, photos, files, voice notes, stickers, GIFs, reactions and replies, and when messages were read. If you delete a message, its text and file are removed. For calls we keep who called, when, for how long and how it ended. We do not record the sound or picture of a call.</p>
            <p><strong>Your picture and look.</strong> A profile picture, if you add one, and the colours you pick for the portal.</p>
            <p><strong>Practice interview.</strong> If you use the interview practice, the answers you type, your score and the feedback.</p>
            <p><strong>What the assistant remembers.</strong> After you write to us, a short summary of your conversations and a list of lasting facts (for example a course you are interested in) are kept, and shown to your counselor as a note. A new fact replaces one you contradict.</p>
            <p><strong>Notifications.</strong> If you allow them, your browser gives us an address for sending notifications to your device. We also keep a log of the emails the portal sends you.</p>
            <p><strong>If you use the chat on our website.</strong> What you type, the name, email or phone number you give, what you want to study, a summary of the chat, the time you agreed to the notice, and a cookie that lets you come back to your chat. To limit misuse we keep a scrambled version of your IP address that cannot be turned back into the address.</p>
            <p><strong>Technical details.</strong> The companies that host the portal may record your IP address and browser type in their server logs.</p>
          </section>

          <section id="use">
            <h2><span>{num()}</span>How we use it</h2>
            <ul className="pp-list">
              <li>To set up and run your application: check your documents, move it through the steps of your school, and contact you by email, phone, message or call.</li>
              <li>To apply to the university or school you choose and follow the application through.</li>
              <li>To remind you of documents we still need and of interviews and deadlines.</li>
              <li>To answer questions from people considering study with us.</li>
              <li>To count how many students come from each source, country and school, so we can improve our service. Those counts do not name anyone.</li>
              <li>To keep the portal secure, and to keep our records in order and follow the law.</li>
            </ul>
            <p>Our reasons are that you asked us to help with your application, that you give us permission when you send the form or start a chat, that it is in our interest to run and improve our service, and that the law sometimes requires us to keep or share information.</p>
          </section>

          <section id="share">
            <h2><span>{num()}</span>Who sees it</h2>
            <ul className="pp-list">
              <li><strong>The WhiteRock team.</strong> Each person signs in with their own account. Counselors see only the students assigned to them. Team Heads see the schools, countries or places they oversee. Administrators see the countries they manage. Every time a team member opens or downloads one of your documents, we record who and when.</li>
              <li><strong>Services that run our systems</strong>, listed in section 6.</li>
              <li><strong>Universities and schools you choose.</strong> When we apply for you, we send them what they need.</li>
              <li><strong>Authorities or advisers</strong>, only when the law requires it or to protect legal rights.</li>
            </ul>
            <p>Other students never see your information. Your counselor’s name, picture and any badge shown to students appear on your dashboard. We do not sell your information and do not share it with anyone for advertising.</p>
          </section>

          <section id="ai">
            <h2><span>{num()}</span>Software and AI</h2>
            <p>We use AI to help our team work faster. These are all the places it is used.</p>
            <ul className="pp-list">
              <li><strong>The chat on our website.</strong> What a visitor types is sent to an AI service, which writes a reply that is shown with an AI label. It never sees student records. If you ask for a person, our team is told, and once a person replies the assistant stops answering that chat. It cannot promise anything on our behalf.</li>
              <li><strong>Drafting replies for our team.</strong> To suggest an answer, the AI is given facts about your application (such as its status, stage and the documents asked), your earlier messages, what the assistant remembers, and WhiteRock’s own guidance for your country. Names, email addresses and phone numbers are not sent. A team member reads and sends the reply. In countries where an administrator has switched on automatic replies, the assistant may answer a message itself. It is shown with an “AI assistant” tag and does not answer voice-only messages. Automatic replies are off unless an administrator turns them on.</li>
              <li><strong>Remembering.</strong> The summary and list of facts in section 2 are written by AI from your recent messages.</li>
              <li><strong>Reading documents.</strong> Passport pages are read inside our own system from the machine-readable lines at the bottom, with no AI, and the passport text does not leave the portal. For other documents, Google reads the text, and an AI service then helps work out what the document is, after we hide numbers that look like ID numbers.</li>
              <li><strong>Practice interview.</strong> Your typed answer, with your programme, school and intake, is sent to an AI service that scores it and writes feedback.</li>
              <li><strong>Voice notes.</strong> When our team has switched this on, the recording is sent to a speech-to-text service to write down what was said. The words are shown to our team. Names, numbers and links are removed before the words are used for drafting replies. When it is off, nothing leaves the portal.</li>
            </ul>
            <p>AI never decides on its own whether your application goes ahead. People review your documents and move your application between steps.</p>
          </section>

          <section id="services">
            <h2><span>{num()}</span>Services we use</h2>
            <p>These companies handle information for us. They may see the parts listed.</p>
            <div className="pp-table" role="region" aria-label="Services we use" tabIndex={0}>
              <table>
                <thead><tr><th scope="col">Service</th><th scope="col">What it does for us</th><th scope="col">What it can see</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Supabase</th><td data-label="What it does for us">Our database, sign-in, storage for chat files and pictures, and live updates</td><td data-label="What it can see">What the portal stores about you</td></tr>
                  <tr><th scope="row">Vercel</th><td data-label="What it does for us">Hosts the portal</td><td data-label="What it can see">Requests to the portal, including IP address and browser type</td></tr>
                  <tr><th scope="row">Google</th><td data-label="What it does for us">Drive and Sheets for documents and the application list, sending our emails, Meet links for interviews, “Continue with Google”, and the script that connects them</td><td data-label="What it can see">Your documents and details, and the emails we send</td></tr>
                  <tr><th scope="row">Alibaba Cloud (Qwen)</th><td data-label="What it does for us">The AI model for the uses in section 5</td><td data-label="What it can see">The text sent for each task</td></tr>
                  <tr><th scope="row">Groq</th><td data-label="What it does for us">Speech-to-text for voice notes, only when switched on</td><td data-label="What it can see">The voice recording</td></tr>
                  <tr><th scope="row">GIPHY</th><td data-label="What it does for us">GIF search in the chat</td><td data-label="What it can see">The words you search for. GIFs load from GIPHY to your device, so GIPHY sees your IP address</td></tr>
                  <tr><th scope="row">YouTube</th><td data-label="What it does for us">The practice interview training video, loaded only when you press play, in YouTube’s privacy-enhanced mode</td><td data-label="What it can see">Your IP address once you press play</td></tr>
                  <tr><th scope="row">Google and Cloudflare</th><td data-label="What it does for us">Connecting calls (relay servers)</td><td data-label="What it can see">IP addresses. Call sound and picture are encrypted between the devices</td></tr>
                  <tr><th scope="row">Browser push services (Google, Apple, Mozilla, Microsoft)</th><td data-label="What it does for us">Delivering notifications to your device</td><td data-label="What it can see">That a notification was sent to your device</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="where">
            <h2><span>{num()}</span>Where it is kept</h2>
            <p>The portal’s database is in Ireland and its servers are in Dublin. Google keeps files in its own data centres in different countries. Some of the other services, such as our AI and speech-to-text providers, may handle information outside the UK and Europe, so your information may be handled outside the country you live in. When we apply to a university, your information goes to that university, which is usually in the UK.</p>
          </section>

          <section id="keep">
            <h2><span>{num()}</span>How long we keep it</h2>
            <p>We keep your information while we are working on your application. After that we keep it as long as we need it to answer your questions, to help with later applications and to meet our record-keeping and legal duties. When we no longer need it, we delete it or remove anything that identifies you. Chats from people who never became students are removed when we no longer need them.</p>
            <p>Each night the portal makes a private copy of its data for safety, and keeps the last {keep}. Older copies are deleted. If you delete a message or a file, it is removed from the portal straight away, and may stay in those copies until they expire.</p>
          </section>

          <section id="safe">
            <h2><span>{num()}</span>Keeping it safe</h2>
            <ul className="pp-list">
              <li>Everything travels over an encrypted connection.</li>
              <li>You sign in with an emailed code or with Google. Our team signs in with their own accounts, can add a second step with an authenticator app, and is signed out after a period of no activity.</li>
              <li>Documents and chat files are not public links. They are opened through the portal after we check who is asking, and team access is recorded.</li>
              <li>Access is limited to the people who need it for their work.</li>
            </ul>
            <p>Profile pictures are the exception: a picture’s address is not secret, so anyone who has the exact address can open it. No system is perfectly safe, so if you think something has gone wrong with your information, please tell us straight away.</p>
          </section>

          <section id="cookies">
            <h2><span>{num()}</span>Cookies and stored settings</h2>
            <p>We use only what the portal needs to work. There are no advertising or analytics cookies.</p>
            <div className="pp-table" role="region" aria-label="Cookies and stored settings" tabIndex={0}>
              <table>
                <thead><tr><th scope="col">Name</th><th scope="col">What it is for</th><th scope="col">How long</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Sign-in cookies (sb-…)</th><td data-label="What it is for">Keep you signed in</td><td data-label="How long">While you stay signed in</td></tr>
                  <tr><th scope="row">wr_theme</th><td data-label="What it is for">Your colours and light or dark look</td><td data-label="How long">1 year</td></tr>
                  <tr><th scope="row">hl_… (chat)</th><td data-label="What it is for">Lets a visitor come back to their chat on our website</td><td data-label="How long">90 days</td></tr>
                  <tr><th scope="row">Saved on your device</th><td data-label="What it is for">Your sticker favourites, whether you saw the welcome tour and the notification reminder, which celebrations you have already seen, a recent-visit marker for the opening animation, the key that lets the website chat bubble find your chat, and unsent practice-interview drafts</td><td data-label="How long">Until you clear your browser data</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="team">
            <h2><span>{num()}</span>Team members</h2>
            <p>If you work for WhiteRock, your name, email, picture, cover photo, title, bio and badges are shown to other team members, and students see the name, picture and student-visible badges of their counselor. We record which documents you open and the changes you make to applications, such as moving a stage or changing who looks after a student. Profile text and badges are descriptions only: they do not give access to anything.</p>
          </section>

          <section id="rights">
            <h2><span>{num()}</span>Your choices</h2>
            <p>You can ask us to:</p>
            <ul className="pp-list">
              <li>give you a copy of the information we hold about you</li>
              <li>correct anything that is wrong</li>
              <li>delete your information (we may then be unable to continue your application)</li>
              <li>limit how we use it, or stop using it for a purpose you object to</li>
              <li>take back a permission you gave us</li>
            </ul>
            <p>You can also delete your own messages and your profile picture in the portal, turn off notifications in your browser, and sign out at any time. To make a request, email us from the address on your application. We may need to check it is really you before we share or change anything, and we will answer as soon as we can. You can also complain to the data protection authority in your country if you are not happy with how we have handled your information.</p>
          </section>

          <section id="changes">
            <h2><span>{num()}</span>Changes to this policy</h2>
            <p>If we change this policy, we will change the date at the top. If a change matters to how we use your information, we will tell you.</p>
            <div className="pp-contact">
              <strong>Questions or requests?</strong>
              <span>Email <Mail /> and say which student and application it is about.</span>
            </div>
          </section>
        </article>

        <footer className="pp-foot">© {new Date().getFullYear()} WhiteRock Educational Services</footer>
      </div>
    </div>
  );
}
