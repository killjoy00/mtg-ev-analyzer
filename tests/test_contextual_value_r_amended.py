import gzip
import json
import tempfile
import unittest
from pathlib import Path

try:
    import numpy as np
except ModuleNotFoundError:
    np = None


@unittest.skipIf(np is None, "NumPy is not installed in the generic repo test job")
class AmendedRTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from contextual_value_candidate_advantage_r_common import (
            align_nuisance,
            build_control_schema,
            calibrate_lcb_c,
            choose_r_lcb,
            compute_residual,
            compute_z,
            fit_r_prime,
            load_fold,
            read_nuisance,
        )
        from contextual_value_draft_weighted_ope import (
            eligible_p1p1_p1p8,
            evaluate_draft_weighted,
            paired_delta,
        )
        cls.align_nuisance = staticmethod(align_nuisance)
        cls.build_control_schema = staticmethod(build_control_schema)
        cls.calibrate_lcb_c = staticmethod(calibrate_lcb_c)
        cls.choose_r_lcb = staticmethod(choose_r_lcb)
        cls.compute_residual = staticmethod(compute_residual)
        cls.compute_z = staticmethod(compute_z)
        cls.fit_r_prime = staticmethod(fit_r_prime)
        cls.load_fold = staticmethod(load_fold)
        cls.read_nuisance = staticmethod(read_nuisance)
        cls.eligible_p1p1_p1p8 = staticmethod(eligible_p1p1_p1p8)
        cls.evaluate_draft_weighted = staticmethod(evaluate_draft_weighted)
        cls.paired_delta = staticmethod(paired_delta)

    def _synthetic_fold(self, n=240, p=4, seed=529):
        rng=np.random.default_rng(seed)
        offsets=np.arange(0,2*n+1,2,dtype=np.int64)
        names=np.tile(np.asarray(["A","B"]),n)
        skill=np.repeat(np.linspace(0.45,0.65,n),1)
        experience=np.linspace(2.0,7.0,n)
        state=np.column_stack([
            np.full(n,2.0), experience, np.zeros(n), np.arange(n)%8,
            np.zeros(n), np.zeros(n), np.zeros(n), np.zeros(n),
            np.zeros(n), np.zeros(n), np.zeros(n), np.ones(n),
            np.zeros(n), np.ones(n), np.zeros(n), np.zeros(n), skill,
        ])
        cand=np.empty((2*n,p),dtype=float)
        selected=np.empty(n,dtype=np.int64)
        outcome=np.empty(n,dtype=float)
        behavior=np.empty(2*n,dtype=float)
        q=np.empty(2*n,dtype=float)
        phi=np.empty(2*n,dtype=float)
        expansion=np.asarray(["MSH","SOS","ECL","TLA"]*(n//4) + ["MSH"]*(n%4))
        draft_ids=np.asarray([f"d{i//3}" for i in range(n)])
        decision_ids=np.asarray([f"dec{i}" for i in range(n)])
        for i in range(n):
            s=2*i
            xA=np.asarray([1.0, skill[i], 0.2, float(i%3==0)])
            xB=np.asarray([0.0, -skill[i], -0.1, float(i%3==1)])
            cand[s]=xA; cand[s+1]=xB
            pA=0.75 if skill[i]>.55 else 0.25
            behavior[s:s+2]=[pA,1-pA]
            selected[i]=0 if rng.random()<pA else 1
            # True causal candidate-A advantage = +0.35, plus skill baseline.
            baseline=1.5+2.0*(skill[i]-.55)
            outcome[i]=baseline+(0.35 if selected[i]==0 else 0.0)+rng.normal(0,.15)
            q[s:s+2]=[baseline,baseline]
            phi[s:s+2]=q[s:s+2]
            g=s+selected[i]
            phi[g]=q[g]+min(20.0,1.0/behavior[g])*(outcome[i]-q[g])
        return {
            "fold":np.asarray([0],dtype=np.int16),
            "state_rich":state,
            "cand_rich":cand,
            "offsets":offsets,
            "candidate_names":names,
            "decision_ids":decision_ids,
            "draft_ids":draft_ids,
            "expansion":expansion,
            "pack_number":np.zeros(n,dtype=np.int16),
            "pick_number":np.arange(n,dtype=np.int16)%8,
            "skill_rate":skill,
            "user_games_lower_bound":np.full(n,500,dtype=np.int64),
            "selected_ord":selected,
            "incumbent_ord":np.ones(n,dtype=np.int64),
            "decision_weight":np.ones(n,dtype=float),
            "outcome":outcome,
            "phi_simple":phi,
        }, behavior, q

    def test_loader_join_fit_lcb_smoke(self):
        data,behavior,q=self._synthetic_fold()
        with tempfile.TemporaryDirectory() as td:
            td=Path(td)
            npz=td/"phase-a2-fold-0.npz"
            report=td/"phase-a2-fold-0-report.json"
            nuis=td/"strong_offset_only-fold-0.jsonl.gz"
            np.savez_compressed(npz,**data)
            report.write_text(json.dumps({"fold":0,"assessment_opened":False,"assessment_outcomes_used":False}))
            with gzip.open(nuis,"wt",encoding="utf-8") as fh:
                for i,did in enumerate(data["decision_ids"]):
                    s=2*i
                    fh.write(json.dumps({
                        "fold":0,
                        "decision_id":str(did),
                        "behavior":{"A":float(behavior[s]),"B":float(behavior[s+1])},
                        "q_values":{"A":float(q[s]),"B":float(q[s+1])},
                        "training_draft_count":100,
                    })+"\n")
            loaded=self.load_fold(npz,report,include_outcome=True)
            rows=self.read_nuisance(nuis,0)
            b,qj,stats=self.align_nuisance(loaded,rows,verify_phi=True)
            self.assertEqual(stats["unselected_phi_q_max_error"],0.0)
            self.assertLessEqual(stats["selected_phi_recompute_max_error"],1e-10)
            z=self.compute_z(loaded,b)
            resid=self.compute_residual(loaded,b,qj)
            names=["f0","f1","f2","f3"]
            schema=self.build_control_schema(loaded,[
                "base:candidate_count","base:log1p_user_games","base:pack_number","base:pick_number",
                "base:pool_size","base:rank=bronze","base:rank=diamond","base:rank=gold",
                "base:rank=mythic","base:rank=platinum","base:rank=silver","base:rank=unknown",
                "base:set=ECL","base:set=MSH","base:set=SOS","base:set=TLA","base:user_game_win_rate",
            ])
            fit=self.fit_r_prime(
                z=z,residual=resid,weight=loaded["decision_weight"],data=loaded,
                feature_names=names,keep_indices=np.arange(4),control_schema=schema,
                global_l2=10.0,set_l2=100.0,
            )
            idx=self.eligible_p1p1_p1p8(loaded["pack_number"],loaded["pick_number"])
            c,diag=self.calibrate_lcb_c(data=loaded,fit=fit,decision_indices=idx,behavior=b,draws=200,seed=529)
            action,policy=self.choose_r_lcb(data=loaded,fit=fit,decision_indices=idx,behavior=b,c=c)
            report_obj={"c":c,"null_rate":diag["chosen_null_deviation_rate"],"intervention_rate":policy["intervention_rate"]}
            self.assertTrue(np.isfinite(report_obj["c"]))
            self.assertLessEqual(report_obj["null_rate"],0.02)
            self.assertEqual(len(action),len(loaded["decision_ids"]))

    def test_all_eligible_draft_weighting_equals_average_of_within_draft_terms(self):
        # Two drafts, each with two eligible decisions. Equal draft weight must
        # remain 50/50 even though decision-level effects differ.
        offsets=np.arange(0,9,2,dtype=np.int64)
        selected=np.asarray([0,0,0,0],dtype=np.int64)
        target_a=np.asarray([0,0,0,0],dtype=np.int64)
        target_b=np.asarray([1,1,1,1],dtype=np.int64)
        outcome=np.asarray([1.0,1.0,3.0,3.0])
        behavior=np.tile(np.asarray([0.5,0.5]),4)
        q=np.zeros(8)
        drafts=np.asarray(["d1","d1","d2","d2"])
        idx=np.arange(4)
        a,at=self.evaluate_draft_weighted(offsets=offsets,selected_ord=selected,target_ord=target_a,outcome=outcome,
            behavior=behavior,q_values=q,draft_ids=drafts,decision_indices=idx,cap=20)
        b,bt=self.evaluate_draft_weighted(offsets=offsets,selected_ord=selected,target_ord=target_b,outcome=outcome,
            behavior=behavior,q_values=q,draft_ids=drafts,decision_indices=idx,cap=20)
        delta=self.paired_delta(b,at)
        self.assertEqual(len(delta),2)
        self.assertAlmostEqual(float(np.mean(delta)),b.dr-a.dr,places=12)

    def test_skill_blind_behavior_and_noisy_skill_q_can_create_false_advantage_under_null(self):
        rng=np.random.default_rng(531)
        n=50000
        skill=rng.normal(size=n)
        # No action effect. Skill drives both behavior and outcome.
        pA=1/(1+np.exp(-1.3*skill))
        action=rng.random(n)<pA
        outcome=1.5+0.8*skill+rng.normal(scale=1.0,size=n)
        # Deliberately misspecified skill-blind behavior.
        eA=np.full(n,0.5)
        # Noisy linear skill proxy in q.
        proxy=skill+rng.normal(scale=1.0,size=n)
        qA=1.5+0.4*proxy
        qB=qA.copy()
        drA=qA + (action/eA)*(outcome-qA)
        drB=qB + ((~action)/(1-eA))*(outcome-qB)
        false_adv=float(np.mean(drA-drB))
        # The point of this test is to make the remaining failure mode explicit,
        # not to require the misspecified estimator to be unbiased.
        self.assertGreater(abs(false_adv),0.05)
        self.false_advantage=false_adv

    def test_multiaction_sensitivity_keeps_third_actions_and_widens_with_gamma(self):
        from contextual_value_multiaction_sensitivity import paired_policy_bounds
        offsets=np.arange(0,13,3,dtype=np.int64)
        selected=np.asarray([0,1,2,0],dtype=np.int64)
        challenger=np.asarray([0,0,0,0],dtype=np.int64)
        incumbent=np.asarray([1,1,1,1],dtype=np.int64)
        outcome=np.asarray([2.0,1.0,4.0,3.0])
        behavior=np.tile(np.asarray([0.4,0.4,0.2]),4)
        q=np.zeros(12)
        drafts=np.asarray(["d1","d1","d2","d2"])
        idx=np.arange(4)
        g1=paired_policy_bounds(
            offsets=offsets,selected_ord=selected,challenger_ord=challenger,incumbent_ord=incumbent,
            outcome=outcome,behavior=behavior,q_values=q,draft_ids=drafts,decision_indices=idx,
            gamma=1.0,cap=20.0,estimator="dr",
        )
        g2=paired_policy_bounds(
            offsets=offsets,selected_ord=selected,challenger_ord=challenger,incumbent_ord=incumbent,
            outcome=outcome,behavior=behavior,q_values=q,draft_ids=drafts,decision_indices=idx,
            gamma=2.0,cap=20.0,estimator="dr",
        )
        self.assertAlmostEqual(g1.lower,g1.upper,places=12)
        self.assertLessEqual(g2.lower,g1.lower)
        self.assertGreaterEqual(g2.upper,g1.upper)

    def test_skill_aware_choice_benchmark_changes_target_odds_without_outcomes(self):
        from contextual_value_candidate_advantage_r_common import (
            fit_skill_interaction_behavior,predict_skill_interaction_behavior,
        )
        data,behavior,_=self._synthetic_fold(n=400,seed=533)
        model=fit_skill_interaction_behavior(data=data,baseline_behavior=behavior,l2=100.0)
        pred=predict_skill_interaction_behavior(model,data=data,baseline_behavior=behavior)
        self.assertEqual(len(pred),len(behavior))
        offsets=data["offsets"]
        sums=np.add.reduceat(pred,offsets[:-1])
        self.assertLess(float(np.max(np.abs(sums-1.0))),1e-10)
        self.assertGreater(float(np.max(np.abs(pred-behavior))),1e-5)


if __name__=="__main__":
    unittest.main()
