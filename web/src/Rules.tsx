export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" role="dialog" aria-label="Règles du jeu">
      <div className="modal-box rules">
        <div className="modal-head">
          <h2>Règles du jeu</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        <h3>Le paquet</h3>
        <p>
          31 cartes : Tchaka ♣, Zing ♦ et Koubi ♥ de 3 à 10, Black ♠ de 3 à 9. Du plus faible au plus fort : 3, 4, 5, 6, 7,
          8, 9, 10. Tables de 2 à 4 joueurs.
        </p>
        <h3>La manche</h3>
        <ul>
          <li>Chaque joueur reçoit 5 cartes (3 puis 2) et joue une carte par pli, 5 plis en tout.</li>
          <li>Le meneur pose la carte de son choix : son enseigne est l'enseigne demandée.</li>
          <li>Si vous avez l'enseigne demandée, vous devez la jouer. Sinon, jouez n'importe quelle carte.</li>
          <li>La plus forte carte de l'enseigne demandée gagne le pli, et son joueur mène le pli suivant.</li>
          <li>Le gagnant du 5e pli gagne la manche. La manche suivante commence par le joueur à sa gauche.</li>
          <li>Vous avez 30 secondes pour jouer, sinon vous êtes considéré comme ayant abandonné.</li>
        </ul>
        <h3>Gains</h3>
        <ul>
          <li>Victoire simple : chaque adversaire paie 1 × la mise.</li>
          <li>Korat (gagner le 5e pli avec un 3) : chaque adversaire paie 2 × la mise.</li>
          <li>Il faut au moins 2 × la mise pour jouer une manche.</li>
          <li>Le croupier prélève 10 % de ce que le vainqueur reçoit.</li>
        </ul>
        <h3>Victoires spéciales (dès la distribution, de la plus forte à la plus faible)</h3>
        <ol>
          <li>Brelan de 7 (trois 7) : simple</li>
          <li>Carré de 7 (les quatre 7) : Korat</li>
          <li>Total des 5 cartes = 16 : Korat</li>
          <li>Carré (quatre cartes de même valeur) : simple</li>
          <li>5 cartes de la même enseigne : simple</li>
          <li>Brelan de 3 : simple</li>
          <li>Total des 5 cartes entre 17 et 21 : simple</li>
        </ol>
        <p>À égalité, la plus petite somme gagne, puis le joueur servi en premier.</p>
        <h3>Abandon</h3>
        <ul>
          <li>
            Le bouton « Abandonner » est disponible après la distribution, jusqu'à ce que le vainqueur du 2e pli joue la
            première carte du 3e pli. Ensuite il disparaît : seul le délai de 30 s fait abandonner.
          </li>
          <li>Abandon avant le 3e pli : vous payez 1 × la mise au vainqueur, même s'il gagne par Korat.</li>
          <li>Abandon à partir du 3e pli (30 s écoulées) : 1 × la mise, ou 2 × si le vainqueur gagne par Korat.</li>
          <li>Vos cartes restantes sont retirées ; celles déjà posées restent visibles mais ne peuvent plus gagner.</li>
          <li>
            Si vous deviez mener, la main passe au joueur qui avait la plus haute carte de l'enseigne demandée au pli
            précédent (au 1er pli : au joueur suivant).
          </li>
          <li>
            S'il ne reste qu'un joueur, il gagne aussitôt : ceux qui ont abandonné avant le 3e pli paient 1 × la mise, ceux
            qui ont abandonné ensuite paient 2 × la mise.
          </li>
        </ul>
        <p className="muted">Les crédits sont virtuels : ils n'ont aucune valeur et ne peuvent pas être échangés contre de l'argent.</p>
      </div>
    </div>
  );
}
