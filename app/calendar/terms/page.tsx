// Terms & conditions page — content carried over from the previous
// calendar.typografie.be deploy. LayoutShell renders the logo + menu.

export const metadata = {
  title: 'Terms & Conditions — Martijn Mertens',
  description: 'Freelance terms and conditions for About Contact / Martijn Mertens.',
}

export default function CalendarTerms() {
  return (
    <main className="page legal">
      <section>
        <h1>Terms &amp; Conditions</h1>
        <p className="updated">Last updated 7 June 2026</p>
      </section>

      <section>
        <p>These Terms and Conditions (&ldquo;Terms&rdquo;) govern the provision of services by About Contact (&ldquo;Service Provider&rdquo;) and the client (&ldquo;Client&rdquo;). By booking services, the Client agrees to be bound by these Terms.</p>
      </section>

      <section>
        <h2>1. Scope of Services</h2>
        <p>The Service Provider offers professional graphic design and related services, including but not limited to Typography, Graphic Design, Branding, Corporate Branding, Generative Design, Event Branding, Brand Strategy, Visual Identity, Logo Design, Typeface Design, Packaging, Advertising, Web Design, Editorial Design, Motion Design, Art Direction, Creative Direction, Concept Development, Company Naming, Posters, and Copywriting.</p>
        <p>All services are performed on a day-to-day basis, with no set deadlines unless explicitly agreed in writing.</p>
      </section>

      <section>
        <h2>2. Fees and Payment Terms</h2>
        <p>The Service Provider&rsquo;s daily rate is &euro;600 per day, excluding VAT.</p>
        <p>For project-based engagements, 50% of the agreed total is invoiced upon acceptance of the quote and is due before work commences. The remaining 50% is invoiced at project completion or against agreed milestones, as specified in the project quote.</p>
        <p>For day-rate engagements without a fixed project total, invoices are issued on the first calendar day of each month for services rendered in the preceding month.</p>
        <p>Payments are due one month from the invoice date unless otherwise specified in writing.</p>
        <p>Late payments may incur interest at the rate specified by Belgian law.</p>
      </section>

      <section>
        <h2>3. Booking and Cancellation</h2>
        <p>Either party may cancel or reschedule services with a minimum of seven (7) calendar days&rsquo; notice.</p>
        <p>If the Client cancels within seven (7) calendar days of the scheduled date, the Client will be liable for 35% of the original booking price.</p>
        <p>The Service Provider reserves the right to cancel or reschedule services with at least seven (7) calendar days&rsquo; notice and will not be held liable for any resulting damages or losses.</p>
      </section>

      <section>
        <h2>4. Intellectual Property</h2>
        <p>Upon full payment of all fees, the Client obtains the rights to the final deliverables created during the service period.</p>
        <p>The Service Provider retains the copyright and moral rights to all creative concepts, drafts, and working files unless otherwise agreed in writing.</p>
        <p>After the project&rsquo;s public launch date, the Service Provider may display, share, and publish any work created for the Client &mdash; including work-in-progress, drafts, sketches, and final deliverables &mdash; on its portfolio, website, social media, and other promotional channels. Until the public launch date, the Service Provider will not share project work publicly without the Client&rsquo;s written consent.</p>
      </section>

      <section>
        <h2>5. Confidentiality</h2>
        <p>The Service Provider agrees to maintain the confidentiality of any non-public information shared by the Client during the course of the project.</p>
        <p>This obligation does not apply to information that becomes public through no fault of the Service Provider or that the Service Provider is legally required to disclose.</p>
      </section>

      <section>
        <h2>6. Liability and Indemnity</h2>
        <p>The Service Provider is not liable for any indirect, incidental, or consequential damages arising from the services provided.</p>
        <p>The Client is responsible for the final review and approval of deliverables. The Service Provider will not be held liable for errors or omissions identified after Client approval.</p>
      </section>

      <section>
        <h2>7. Governing Law and Jurisdiction</h2>
        <p>These Terms are governed by and construed in accordance with the laws of Belgium.</p>
        <p>Any disputes arising from or in connection with these Terms will be subject to the exclusive jurisdiction of the courts in Antwerp, Belgium.</p>
      </section>

      <section>
        <h2>8. General Provisions</h2>
        <p>These Terms constitute the entire agreement between the parties regarding the subject matter and supersede any prior agreements or understandings.</p>
        <p>Any amendments to these Terms must be agreed upon in writing by both parties.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>About Contact &middot; Gudrunlaan 17, 2170 Antwerp &middot; <a href="mailto:hello@aboutcontact.com">hello@aboutcontact.com</a> &middot; +32 493 45 92 96</p>
      </section>

      <a href="/calendar" className="back">← Back to booking</a>
    </main>
  )
}
