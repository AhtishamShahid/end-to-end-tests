import { expect, test } from '../../../src/fixtures';
import { TIMEOUTS } from '../../../src/config';
import { fetchLibrary, listLibraries, listRoleUsers, listTeamMembers } from '../../../src/api';
import { seedScopeAssignments } from '../../../src/steps';
import { testId } from '../../../src/reporting';
import { RBAC_TAGS } from '../helpers';

/**
 * The library half of the console's Team Members tab — the sheet's
 * `STUDIO LIBRARIES: Manage Team` block, which Epic 10 handed over because the
 * library MFE gives team management to this console wherever one is configured.
 *
 * Both cases run with no waffle flag: creating a library makes the worker author
 * its `library_admin`, and library roles are enforced whatever
 * `authz.enable_course_authoring` says.
 */
test.describe(
  'Roles and Permissions console — library team',
  { tag: ['@regression', ...RBAC_TAGS, '@content-libraries'] },
  () => {
    test.describe.configure({ timeout: TIMEOUTS.contentTest });

    test(
      'pages the team at ten rows',
      { annotation: testId('TC-00374') },
      async ({ page, config, adminConsole, authoringLibrary, studioAuthorSession, teamRoster }) => {
        void studioAuthorSession;
        const library = authoringLibrary.id;

        // The sheet wants a team of 12+: eleven accounts with one role each, plus
        // the author's own `library_admin`, which creating the library granted.
        // One role per account makes that twelve rows in either grouping — by
        // assignment (`verawood`) or by user (`main`) — so the pager is measured
        // the same way on both.
        const roster = await teamRoster(11);
        await seedScopeAssignments(
          page.request,
          config,
          library,
          roster.map((account) => account.username),
          ['library_user'],
        );

        await adminConsole.console.goto(library);
        const table = adminConsole.teamMembers;
        const total = (
          await listTeamMembers(page.request, config, await table.grouping(), {
            scopes: [library],
            pageSize: 50,
          })
        ).count;
        expect(total).toBeGreaterThanOrEqual(12);

        // Ten rows on the first page, the rest on the second, and the pager's
        // ends are disabled where there is nowhere further to go.
        await expect(table.rows).toHaveCount(10);
        await expect(table.previousPage).toBeDisabled();
        await expect(table.nextPage).toBeEnabled();

        await table.goToNextPage();
        await expect(table.rows).toHaveCount(total - 10);
        await expect(table.nextPage).toBeDisabled();

        // And the first page is where the table opens: ten rows again, with
        // nowhere to go back to. (Re-entering rather than paging back on
        // purpose: the console refetches on its own schedule and can return to
        // page one underneath a click, which made a "click Previous" step race
        // its own precondition.)
        await adminConsole.console.goto(library);
        await expect(table.rows).toHaveCount(10);
        await expect(table.previousPage).toBeDisabled();
      },
    );

    test(
      'shows a non-member neither the library nor its team',
      { annotation: testId('TC-00373') },
      async ({ config, adminConsole, authoringLibrary, studioAuthorSession, studioColleague }) => {
        void studioAuthorSession;
        const library = authoringLibrary.id;
        const outsider = await studioColleague();

        // Studio does not offer the library to a user with no role in it: it is
        // absent from their library list and refused by key.
        const listed = await listLibraries(outsider.request, config, {
          textSearch: authoringLibrary.slug,
        });
        expect(listed.results.map((entry) => entry.id)).not.toContain(library);
        await expect(fetchLibrary(outsider.request, config, library)).rejects.toMatchObject({
          status: 403,
        });
        await expect(listRoleUsers(outsider.request, config, library)).rejects.toMatchObject({
          status: 403,
        });

        // The console shows them nothing of the library either, in the outsider's
        // own browser. `main` refuses outright — it checks up front whether the
        // caller may view any team, and shows its error view to one who may not.
        // `verawood` has no such check: it renders, with the library's scope
        // preset, an empty table. Either way there are no rows; the refusals
        // above are what actually protects the library.
        const outsiderConsole = adminConsole.consoleFor(outsider.page);
        expect(['refused', 'scoped']).toContain(await outsiderConsole.open(library));
        await expect(adminConsole.teamMembersFor(outsider.page).rows).toHaveCount(0);
      },
    );
  },
);
