"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { helpDocuments, helpFaqs } from "../../lib/helpCenter";
import styles from "./help.module.css";

const SearchIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;

export default function HelpCenter() {
  const [query, setQuery] = useState("");
  const [documentCategory, setDocumentCategory] = useState("All documents");
  const normalizedQuery = query.trim().toLowerCase();
  const categories = useMemo(() => ["All documents", ...Array.from(new Set(helpDocuments.map((document) => document.category)))], []);
  const matchingFaqs = helpFaqs.filter((faq) => `${faq.question} ${faq.answer} ${faq.category}`.toLowerCase().includes(normalizedQuery));
  const matchingDocuments = helpDocuments.filter((document) => {
    const matchesSearch = `${document.title} ${document.description} ${document.category} ${document.audience}`.toLowerCase().includes(normalizedQuery);
    return matchesSearch && (documentCategory === "All documents" || document.category === documentCategory);
  });
  const resultCount = matchingFaqs.length + matchingDocuments.length;

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand} aria-label="Ref Pro Group home"><span>REF PRO</span> GROUP</Link><nav aria-label="Help navigation"><Link href="/">Home</Link><Link href="/login">Sign in</Link></nav></header>
    <section className={styles.intro}>
      <p className={styles.eyebrow}>REF PRO GROUP SUPPORT</p><h1>How can we help?</h1><p>Search answers, instructions and downloadable user guides.</p>
      <label className={styles.search}><SearchIcon/><span className={styles.srOnly}>Search the Help Center</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sign in, assignments, training, documents..."/>{query && <button type="button" onClick={() => setQuery("")}>Clear</button>}</label>
      {query && <p className={styles.resultSummary}>{resultCount} result{resultCount === 1 ? "" : "s"} for “{query}”</p>}
    </section>
    <div className={styles.content}>
      <section className={styles.faqSection} aria-labelledby="faq-heading">
        <div className={styles.sectionHeading}><div><p>QUICK ANSWERS</p><h2 id="faq-heading">Frequently asked questions</h2></div><span>{matchingFaqs.length} answers</span></div>
        <div className={styles.faqList}>{matchingFaqs.map((faq) => <details key={faq.question} className={styles.faqCard} open={Boolean(normalizedQuery)}><summary><span><small>{faq.category}</small>{faq.question}</span><i aria-hidden="true">+</i></summary><p>{faq.answer}</p></details>)}</div>
        {!matchingFaqs.length && <div className={styles.empty}>No FAQs match your search.</div>}
      </section>
      <section className={styles.documentsSection} aria-labelledby="documents-heading">
        <div className={styles.sectionHeading}><div><p>DOWNLOADABLE RESOURCES</p><h2 id="documents-heading">Document directory</h2></div><span>{matchingDocuments.length} document{matchingDocuments.length === 1 ? "" : "s"}</span></div>
        <div className={styles.filters} aria-label="Document categories">{categories.map((category) => <button type="button" key={category} className={documentCategory === category ? styles.activeFilter : ""} onClick={() => setDocumentCategory(category)}>{category}</button>)}</div>
        <div className={styles.documentGrid}>{matchingDocuments.map((document) => <article className={styles.documentCard} key={document.href}><div className={styles.pdfBadge}>PDF</div><div className={styles.documentInfo}><p>{document.category} · {document.audience}</p><h3>{document.title}</h3><span>{document.description}</span><small>Updated {document.updated}</small></div><div className={styles.documentActions}><a href={document.href} target="_blank" rel="noreferrer">View PDF</a><a href={document.href} download>Download</a></div></article>)}</div>
        {!matchingDocuments.length && <div className={styles.empty}>No documents match your search or selected category.</div>}
      </section>
    </div>
    <section className={styles.contact}><div><p>STILL NEED HELP?</p><h2>Contact Ref Pro Group</h2></div><a href="mailto:Erin.Green@ref-assign.com">Erin.Green@ref-assign.com</a></section>
  </main>;
}
