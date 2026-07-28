"""
content_guard.py  —  a safety net for what goes ON the map

What this does, in plain English:
  Every pin on this public map makes a claim about the Senator and points to a
  source. Two things can quietly go wrong, and both hurt the map's credibility:

    1. A BAD SOURCE LINK. The whole promise of this map is "no pin without a
       source, and the source is trustworthy." If a link points somewhere
       random (a personal blog, a made-up site), the pin is no longer
       defensible. This module checks that a link points to one of three
       approved kinds of source: an official government site, one of Senator
       Josh Becker's OWN official accounts, or a reputable local news outlet.

    2. BAD WORDING. The map is a public, professional record of what the
       Senator did. It must read cleanly AND it must never speak negatively or
       controversially about him (no "failed," "scandal," "slammed," etc.).
       This module scans a title/summary for run-on sentences, unexplained
       jargon, and any negative/controversial words, and warns you before you
       publish.

  This is a GUARDRAIL, not a judge. It warns and explains; a human (Huck) still
  makes the final call. "warn" means "stop and double-check," not "forbidden."

Use it from the command line:
    python3 scripts/content_guard.py --url "https://sd13.senate.ca.gov/..."
    python3 scripts/content_guard.py --text "Senator Becker helped fund..."
    python3 scripts/content_guard.py            (runs the built-in self-test)

Or import it in other scripts:
    from content_guard import check_source, check_language, check_source_stance
"""

import sys
import urllib.parse


# ---------------------------------------------------------------------------
# JOB 1 — SOURCE-LINK GUARDRAIL
# ---------------------------------------------------------------------------
#
# The policy (decided by the project owner) allows three kinds of source:
#   (a) official government sites   -> any domain ending in .gov
#   (b) Becker's own official accounts (websites + social handles)
#   (c) reputable local news outlets
# Anything else is rejected until a human confirms it belongs.

# (b) BECKER OFFICIAL ACCOUNTS
# ---------------------------------------------------------------------------
# These are Senator Josh Becker's OWN official channels. A link into one of
# these is as trustworthy as a government site, because it's the Senator
# speaking for himself.
#
# Confirmed via web search (July 2026), CA Senate District 13:
#   * Instagram:  https://www.instagram.com/josh.becker.ca/   (handle: josh.becker.ca)
#   * X/Twitter:  https://x.com/SenJoshBecker                 (official Senate account)
#   * X/Twitter:  https://x.com/JoshBeckerSV                  (his other verified handle)
#   * Facebook:   https://www.facebook.com/sen.josh.becker/   (handle: sen.josh.becker)
#   * Campaign site: joshbeckerforcalifornia.com  (his own official site, not .gov)
#
# NOTE for Huck: the social-media entries below are stored as the lowercase
# "handle" text we expect to see somewhere in the URL (e.g. "josh.becker.ca").
# That's how we tell "a post from Becker's real account" apart from "a random
# Instagram link that just happens to be on instagram.com" (see the warn case).
BECKER_OFFICIAL_HANDLES = {
    "josh.becker.ca",   # Instagram
    "senjoshbecker",    # X / Twitter (official Senate account)
    "joshbeckersv",     # X / Twitter (his other handle)
    "sen.josh.becker",  # Facebook
}

# His own official (non-.gov) websites, matched as registered domains.
BECKER_OFFICIAL_DOMAINS = {
    "joshbeckerforcalifornia.com",
}

# The social-media hosts where a bare "permalink" (like instagram.com/p/ABC123)
# hides which account posted it. On these hosts we can only say "ok" if the URL
# actually contains one of Becker's known handles above; otherwise we "warn".
SOCIAL_HOSTS = {
    "instagram.com",
    "facebook.com",
    "twitter.com",
    "x.com",
}

# (c) REPUTABLE LOCAL NEWS
# ---------------------------------------------------------------------------
# Well-known Peninsula / Bay Area outlets. Editable — add outlets as needed.
# paloaltoonline.com MUST stay here; an existing pin relies on it.
LOCAL_NEWS = {
    "paloaltoonline.com",
    "almanacnews.com",
    "mv-voice.com",
    "smdailyjournal.com",
    "padailypost.com",
    "mercurynews.com",
    "sfchronicle.com",
    "sfgate.com",
    "kqed.org",
    "abc7news.com",
    "nbcbayarea.com",
}


def get_host(url):
    """
    Pull the lowercase host (the 'example.com' part) out of a URL.

    We add '//' if the URL was written without a scheme (e.g. "example.com/x"),
    because urlparse only finds the host when it sees the '//'. We also drop any
    ':port' at the end. Returns "" if we can't find a host.
    """
    url = url.strip()
    if "//" not in url:
        url = "//" + url
    host = urllib.parse.urlparse(url).netloc.lower()
    if "@" in host:          # strip any user:pass@ prefix
        host = host.split("@")[-1]
    if ":" in host:          # strip :port
        host = host.split(":")[0]
    return host


def host_matches_domain(host, domain):
    """
    Is `host` really inside `domain`, and not a look-alike trick?

    True only when the host IS the domain, or is a real sub-domain of it
    (ends with "." + domain). This is what stops fakes like:
        notgov.com                -> not ".gov"        (no leading dot)
        evil-ca.gov.attacker.com  -> host ends in attacker.com, not ca.gov
    """
    return host == domain or host.endswith("." + domain)


def check_source(url):
    """
    Decide whether a source link is allowed.

    Returns (ok, level, message):
        ok    -> True only when level == "ok"
        level -> "ok" | "warn" | "reject"
        message -> plain-English explanation for Huck
    """
    host = get_host(url)
    if not host:
        return (False, "reject",
                "Couldn't read a website out of that link. Check it's a full URL "
                "(like https://sd13.senate.ca.gov/...).")

    # (a) OFFICIAL GOVERNMENT — any *.gov host. We treat "gov" as the domain so
    #     the sub-domain trick guard applies (host == "gov" never happens, but
    #     "sd13.senate.ca.gov" ends with ".gov", while "notgov.com" does not).
    if host == "gov" or host.endswith(".gov"):
        return (True, "ok", f"Official government source ({host}). Approved.")

    # (b) BECKER'S OWN OFFICIAL WEBSITES (e.g. his campaign site).
    for domain in BECKER_OFFICIAL_DOMAINS:
        if host_matches_domain(host, domain):
            return (True, "ok",
                    f"Senator Becker's official site ({host}). Approved.")

    # (b) BECKER'S SOCIAL ACCOUNTS — the tricky case.
    #     If this is a social host, look for a known handle anywhere in the URL.
    for social in SOCIAL_HOSTS:
        if host_matches_domain(host, social):
            url_lower = url.lower()
            for handle in BECKER_OFFICIAL_HANDLES:
                if handle in url_lower:
                    return (True, "ok",
                            f"Posted by Becker's official account ({handle}). Approved.")
            # A bare permalink (e.g. instagram.com/p/ABC123) doesn't name the
            # account, so we can't prove it's his from the URL alone.
            return (False, "warn",
                    "Social post — confirm this is posted by Becker's official "
                    "account before publishing.")

    # (c) REPUTABLE LOCAL NEWS.
    for domain in LOCAL_NEWS:
        if host_matches_domain(host, domain):
            return (True, "ok",
                    f"Reputable local news outlet ({host}). Approved.")

    # ANYTHING ELSE — not on any allowlist. Reject until a human vouches for it.
    return (False, "reject",
            f"Source not recognized ({host}). Only official government sites, "
            "Senator Becker's official accounts, or reputable local news outlets "
            "are allowed. Double-check the source before using it.")


# ---------------------------------------------------------------------------
# JOB 2 — LANGUAGE GUARDRAIL
# ---------------------------------------------------------------------------
#
# Pin titles/summaries are the actual product people read. Two rules:
#   * Readability — a normal person should understand it at a glance.
#   * Never negative/controversial about the Senator — this is a professional
#     record, not a debate. Even quoting an attack word ("slammed") reads wrong.
#
# These are simple, standard-library heuristics. They catch the obvious stuff
# and leave the final wording to Huck (he knows the politics).

# Rough cap on sentence length. Past ~40 words a sentence gets hard to follow.
LONG_SENTENCE_WORDS = 40

# Words/phrases that read as negative, partisan-attack, or controversial.
# Editable — add anything that would make the map sound like it's taking a
# swing at the Senator. Kept lowercase; we match case-insensitively.
NEGATIVE_TERMS = [
    "failed",
    "failure",
    "scandal",
    "controversial",
    "controversy",
    "slammed",
    "blasted",
    "corrupt",
    "corruption",
    "attacked",
    "attack on",
    "lawsuit against",
    "under fire",
    "backlash",
    "disgraced",
    "embattled",
    "damn",
    "hell",  # mild profanity; unprofessional in this context
]

# Common acronyms/jargon that a normal reader may not know. If one appears
# without being spelled out nearby, we suggest explaining it. Editable.
JARGON_TERMS = [
    "CEQA",
    "CARB",
    "GHG",
    "AB",    # Assembly Bill — fine, but spell it out the first time
    "SB",    # Senate Bill
    "JPA",
    "MOU",
    "CIP",
    "FY",
]


# ---------------------------------------------------------------------------
# JOB 3 — SOURCE-STANCE GUARDRAIL (added at Huck's request)
# ---------------------------------------------------------------------------
#
# A link can be from an allowed outlet (say, a real local paper) and STILL be a
# bad pin — because the ARTICLE ITSELF is critical of the Senator. Routing a
# constituent from a proud accomplishment to a story that undercuts it hurts the
# map. Example that prompted this: a local-news piece on bike lanes Becker backed,
# headlined "...few appear to use them yet" — an allowed outlet, a negative frame.
#
# HONEST LIMITATION: this is a static script. It cannot read a web page or judge
# tone the way a person can. It scans the SOURCE ARTICLE'S HEADLINE/TITLE (which
# the person adding the pin passes in) for wording that reads as critical. It's a
# backstop that catches the obvious cases; the real safeguard is still a human
# reading the source before citing it. Treat a hit as "do not use this source."
SOURCE_CRITICAL_TERMS = [
    "few appear to use", "appear to use them", "hardly used", "barely used",
    "sparsely used", "little used", "little-used", "underused", "under-used",
    "no one uses", "nobody uses", "empty bike lane", "not effective",
    "ineffective", "waste of money", "wasteful", "boondoggle", "criticized",
    "criticism", "slammed", "blasted", "backlash", "under fire", "disappointing",
    "fails to", "failed to", "falls short", "questioned whether", "controversial",
    "controversy", "opposes", "opposed by", "protest",
]


def check_source_stance(headline):
    """
    Scan a SOURCE article's headline/title for wording that reads as critical of
    the Senator or his work.

    Returns (ok, hits):
        ok   -> True only when no critical wording is found
        hits -> the critical phrases spotted (for a plain-English explanation)

    Pass the actual headline of the page you're citing. Empty/blank input is
    treated as "ok" (nothing to check) — but that means nobody vetted the frame,
    so add.py still nudges you to look.
    """
    if not headline or not headline.strip():
        return (True, [])
    lower = headline.lower()
    hits = [term for term in SOURCE_CRITICAL_TERMS if term in lower]
    return (len(hits) == 0, sorted(set(hits)))


def split_sentences(text):
    """
    Break text into rough sentences on . ! ? — good enough for a length check.
    Not perfect grammar; we only need to spot the run-ons.
    """
    sentence = ""
    sentences = []
    for char in text:
        sentence += char
        if char in ".!?":
            sentences.append(sentence.strip())
            sentence = ""
    if sentence.strip():
        sentences.append(sentence.strip())
    return [s for s in sentences if s]


def check_language(text):
    """
    Scan a title/summary for readability and negative/controversial wording.

    Returns (ok, warnings):
        ok       -> True only when there are NO warnings
        warnings -> list of plain-English problems to look at
    """
    warnings = []
    lower = text.lower()

    # --- Readability: run-on sentences ---
    for sentence in split_sentences(text):
        word_count = len(sentence.split())
        if word_count > LONG_SENTENCE_WORDS:
            preview = sentence[:50] + ("..." if len(sentence) > 50 else "")
            warnings.append(
                f"Long sentence ({word_count} words) — consider splitting it so "
                f"it's easier to read: \"{preview}\"")

    # --- Readability: unexplained jargon/acronyms ---
    # We treat an acronym as "explained" if a '(' appears somewhere after it
    # (e.g. "CEQA (the state environmental law)"). Simple, not bulletproof.
    words = text.replace("(", " ( ").split()
    for term in JARGON_TERMS:
        for i, word in enumerate(words):
            # strip surrounding punctuation for the comparison
            bare = word.strip(".,:;!?()'\"")
            if bare == term:
                explained = "(" in " ".join(words[i:i + 4])
                if not explained:
                    warnings.append(
                        f"Jargon/acronym \"{term}\" — spell it out or explain it "
                        "so a normal reader understands.")
                break  # one warning per term is enough

    # --- Negativity / controversy ---
    hits = [term for term in NEGATIVE_TERMS if term in lower]
    if hits:
        warnings.append(
            "Possible negative/controversial wording "
            f"({', '.join(sorted(set(hits)))}) — the map must never speak "
            "negatively or controversially about the Senator. Rephrase in "
            "neutral, professional terms.")

    return (len(warnings) == 0, warnings)


# ---------------------------------------------------------------------------
# COMMAND-LINE INTERFACE + SELF-TEST
# ---------------------------------------------------------------------------

def print_source_verdict(url):
    ok, level, message = check_source(url)
    print(f"URL:   {url}")
    print(f"Level: {level.upper()}")
    print(f"       {message}")


def print_language_verdict(text):
    ok, warnings = check_language(text)
    print(f"TEXT:  {text}")
    if ok:
        print("       No warnings — reads clean.")
    else:
        for w in warnings:
            print(f"  WARN {w}")


def self_test():
    """
    Built-in check that the guardrails behave. Prints PASS/FAIL per case.
    Run with no arguments: python3 scripts/content_guard.py
    """
    print("Running content_guard self-test...\n")
    passed = 0
    failed = 0

    def check(name, condition):
        nonlocal passed, failed
        if condition:
            print(f"PASS  {name}")
            passed += 1
        else:
            print(f"FAIL  {name}")
            failed += 1

    # --- Source checks ---
    ok, level, _ = check_source("https://sd13.senate.ca.gov/legislation/sb-123")
    check("sd13.senate.ca.gov is OK", ok and level == "ok")

    ok, level, _ = check_source("https://www.paloaltoonline.com/news/2024/creek")
    check("paloaltoonline.com is OK", ok and level == "ok")

    ok, level, _ = check_source("https://www.instagram.com/p/xyz123/")
    check("bare instagram permalink is WARN", (not ok) and level == "warn")

    ok, level, _ = check_source("https://www.instagram.com/josh.becker.ca/reel/xyz")
    check("instagram link WITH Becker handle is OK", ok and level == "ok")

    ok, level, _ = check_source("https://random-thoughts.blogspot.com/post")
    check("random blogspot.com is REJECT", (not ok) and level == "reject")

    ok, level, _ = check_source("https://notgov.com/page")
    check("notgov.com is NOT treated as gov (REJECT)", (not ok) and level == "reject")

    ok, level, _ = check_source("https://evil-ca.gov.attacker.com/page")
    check("ca.gov look-alike is REJECT", (not ok) and level == "reject")

    # --- Language checks ---
    clean = ("Senator Becker helped secure funding to restore San Francisquito "
             "Creek. The project reduces flood risk for nearby homes.")
    ok, warnings = check_language(clean)
    check("clean summary has no warnings", ok and warnings == [])

    run_on = ("The Senator failed to attend the meeting where the plan that had "
              "been developed over many months by a large coalition of local "
              "leaders and community members and city staff and volunteers was "
              "finally presented to the public for review and comment and "
              "eventual approval by the council.")
    ok, warnings = check_language(run_on)
    check("summary with 'failed' + run-on has warnings", (not ok) and len(warnings) >= 1)

    # --- Source-stance checks ---
    ok, hits = check_source_stance("Palo Alto's new bike lanes open, but few appear to use them yet")
    check("critical headline ('few appear to use') is flagged", (not ok) and len(hits) >= 1)

    ok, hits = check_source_stance("Senator Becker secures $2 million for Half Moon Bay farmworker housing")
    check("neutral/positive headline is clean", ok and hits == [])

    ok, hits = check_source_stance("")
    check("blank headline is treated as clean (nothing to check)", ok and hits == [])

    print(f"\nResult: {passed} passed, {failed} failed.")
    return failed == 0


def main(argv):
    # No args -> run the self-test.
    if len(argv) == 0:
        self_test()
        return

    # --url "<url>"  -> source verdict
    # --text "<text>" -> language warnings
    if argv[0] == "--url" and len(argv) >= 2:
        print_source_verdict(argv[1])
    elif argv[0] == "--text" and len(argv) >= 2:
        print_language_verdict(argv[1])
    elif argv[0] == "--source-title" and len(argv) >= 2:
        ok, hits = check_source_stance(argv[1])
        print(f"HEADLINE: {argv[1]}")
        if ok:
            print("          Reads neutral — no critical wording spotted.")
        else:
            print(f"  FLAG    Critical wording ({', '.join(hits)}) — this source "
                  "appears critical of the Senator. Don't route constituents to it.")
    else:
        print("Usage:")
        print('  python3 scripts/content_guard.py --url "<url>"')
        print('  python3 scripts/content_guard.py --text "<text>"')
        print('  python3 scripts/content_guard.py --source-title "<headline>"')
        print("  python3 scripts/content_guard.py            (self-test)")


if __name__ == "__main__":
    main(sys.argv[1:])
