//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import {PoseidonT3} from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    // 8 blank leaves =  4 levels of leaves -> 2**(levels) -1  = 2^4-1 = 15 nodes
    uint256 constant LEVELS = 4; // the number of levels in the tree
    uint256 constant LEAVES = 8; // the number of final leaves in the tree
    uint256 constant NODES_IN_TREE = (2**LEVELS) - 1; // the number of nodes in the tree

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        for (uint256 i = 0; i < NODES_IN_TREE; i++) {
            hashes.push(0); //initialize to blank leaves
        }
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree
        require(index < LEAVES, "No more leaves allowed");
        // store the leaf in the next available leaf slot and prepare index for the next one
        hashes[index++] = hashedLeaf;

        uint256 leaves_counter = LEAVES; //starting on LEAVES

        // iterate over the nodes on the tree and recalculate the hashes, we go 2 by 2 since we have 2 leaves per node
        for (uint256 i = 0; i < NODES_IN_TREE - 1; i += 2) {
            hashes[leaves_counter++] = PoseidonT3.poseidon(
                [hashes[i], hashes[i + 1]]
            );
        }
        // we assign the root of the tree
        root = hashes[NODES_IN_TREE - 1];

        // and we return the root
        return root;
    }

    function verify(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[1] memory input
    ) public view returns (bool) {
        // [assignment] verify an inclusion proof and check that the proof root matches current root
        return ((verifyProof(a, b, c, input) == true)) && (root == input[0]);
    }
}
