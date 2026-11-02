import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { RolesGuard } from "../src/modules/auth/roles.guard.js";

function context(roles: string[]) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ authSession: { user: { roles } } }) })
  } as never;
}

test("roles guard allows a matching operator subrole", () => {
  const reflector = { getAllAndOverride: () => ["operations"] };
  const guard = new RolesGuard(reflector as never);
  assert.equal(guard.canActivate(context(["operations"])), true);
});

test("roles guard rejects an unrelated operator subrole", () => {
  const reflector = { getAllAndOverride: () => ["finance"] };
  const guard = new RolesGuard(reflector as never);
  assert.throws(() => guard.canActivate(context(["support"])), ForbiddenException);
});
